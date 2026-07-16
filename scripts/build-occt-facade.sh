#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'
umask 022

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd -P)"
readonly LOCK_FILE="${REPO_ROOT}/native/occt/upstream.lock.json"
readonly PATCH_DIR="${REPO_ROOT}/native/occt/patches"
readonly ARTIFACTS_ROOT="${REPO_ROOT}/.artifacts"
readonly OUTPUT_DIR="${ARTIFACTS_ROOT}/occt-facade"

SOURCE_DIR=""
CARGO_CACHE_DIR=""
SKIP_FETCH=false
WORK_ROOT=""
ARTIFACT_TEMP=""

usage() {
  cat <<'EOF'
Usage: scripts/build-occt-facade.sh [options]

Build InvariantCAD's digest-pinned OCCT facade and write:
  .artifacts/occt-facade/occt-wasm.js
  .artifacts/occt-facade/occt-wasm.wasm
  .artifacts/occt-facade/SHA256SUMS

Options:
  --source-dir DIR       Use an existing exact upstream checkout. The script
                         verifies HEAD and the OCCT gitlink, then exports HEAD
                         into isolated temporary storage.
  --cargo-cache-dir DIR  Use a dedicated Cargo cache. This directory alone is
                         mounted; never pass a home directory or repository.
  --skip-fetch           Do not clone, pull, or run cargo fetch. Requires
                         --source-dir, --cargo-cache-dir, the pinned image to
                         exist locally, and a previously hydrated Cargo cache.
  -h, --help             Show this help.

The default flow allows network access only while cloning/pulling and in a
dedicated cargo-fetch container. The compilation container uses no network.
EOF
}

log() {
  printf '[occt-facade] %s\n' "$*" >&2
}

die() {
  printf '[occt-facade] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?

  if [[ -n "${ARTIFACT_TEMP}" && -d "${ARTIFACT_TEMP}" ]]; then
    rm -rf -- "${ARTIFACT_TEMP}"
  fi
  if [[ -n "${WORK_ROOT}" && -d "${WORK_ROOT}" ]]; then
    rm -rf -- "${WORK_ROOT}"
  fi

  exit "${status}"
}

trap cleanup EXIT
trap 'die "command failed at line ${LINENO}"' ERR

while (($# > 0)); do
  case "$1" in
    --source-dir)
      (($# >= 2)) || die '--source-dir requires a directory'
      SOURCE_DIR=$2
      shift 2
      ;;
    --cargo-cache-dir)
      (($# >= 2)) || die '--cargo-cache-dir requires a directory'
      CARGO_CACHE_DIR=$2
      shift 2
      ;;
    --skip-fetch)
      SKIP_FETCH=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (use --help)"
      ;;
  esac
done

for required_command in awk basename find git install mktemp patch podman \
  python3 sed sha256sum sort tar; do
  command -v "${required_command}" >/dev/null 2>&1 \
    || die "required command not found: ${required_command}"
done

[[ -f "${LOCK_FILE}" ]] || die "lock file not found: ${LOCK_FILE}"

LOCK_VALUES="$({ python3 - "${LOCK_FILE}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    lock = json.load(handle)

if lock.get("schemaVersion") != 1:
    raise SystemExit("unsupported OCCT lock schema")

values = (
    lock["upstream"]["repository"],
    lock["upstream"]["tag"],
    lock["upstream"]["commit"],
    lock["occt"]["commit"],
    lock["toolchain"]["emscripten"],
    lock["toolchain"]["rust"],
    lock["builder"]["image"],
    lock["builder"]["digest"],
    lock["builder"]["platform"],
)

if not all(isinstance(value, str) and value for value in values):
    raise SystemExit("OCCT lock contains an empty or non-string value")
if any("\t" in value or "\n" in value for value in values):
    raise SystemExit("OCCT lock values may not contain tabs or newlines")

print("\t".join(values))
PY
} 2>&1)" || die "could not read ${LOCK_FILE}: ${LOCK_VALUES}"

IFS=$'\t' read -r \
  UPSTREAM_REPOSITORY \
  UPSTREAM_TAG \
  UPSTREAM_COMMIT \
  OCCT_COMMIT \
  EMSCRIPTEN_VERSION \
  RUST_VERSION \
  BUILDER_IMAGE \
  BUILDER_DIGEST \
  BUILDER_PLATFORM <<<"${LOCK_VALUES}"

[[ "${UPSTREAM_COMMIT}" =~ ^[0-9a-f]{40}$ ]] \
  || die 'upstream commit in lock is not a full SHA-1'
[[ "${OCCT_COMMIT}" =~ ^[0-9a-f]{40}$ ]] \
  || die 'OCCT commit in lock is not a full SHA-1'
[[ "${BUILDER_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || die 'builder digest in lock is not a full SHA-256 digest'

readonly PINNED_IMAGE="${BUILDER_IMAGE}@${BUILDER_DIGEST}"

[[ "$(id -u)" -ne 0 ]] \
  || die 'run this script as an unprivileged user, not root'
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == 'true' ]] \
  || die 'Podman must be configured in rootless mode'

WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/invariantcad-occt-facade.XXXXXXXX")"
readonly STAGED_SOURCE="${WORK_ROOT}/source"

canonicalize_directory() {
  local path=$1

  mkdir -p -- "${path}"
  (CDPATH= cd -- "${path}" && pwd -P)
}

verify_source() {
  local source=$1
  local actual_head
  local actual_occt

  git -C "${source}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "source is not a Git worktree: ${source}"

  actual_head="$(git -C "${source}" rev-parse HEAD^{commit})"
  [[ "${actual_head}" == "${UPSTREAM_COMMIT}" ]] \
    || die "source HEAD is ${actual_head}; expected ${UPSTREAM_COMMIT} (${UPSTREAM_TAG})"

  actual_occt="$(git -C "${source}" ls-tree HEAD occt | awk '$1 == "160000" { print $3 }')"
  [[ "${actual_occt}" == "${OCCT_COMMIT}" ]] \
    || die "source OCCT gitlink is ${actual_occt:-missing}; expected ${OCCT_COMMIT}"
}

if [[ "${SKIP_FETCH}" == true ]]; then
  [[ -n "${SOURCE_DIR}" ]] \
    || die '--skip-fetch requires --source-dir because cloning is disabled'
  [[ -n "${CARGO_CACHE_DIR}" ]] \
    || die '--skip-fetch requires --cargo-cache-dir with a hydrated cache'
fi

if [[ -n "${SOURCE_DIR}" ]]; then
  [[ -d "${SOURCE_DIR}" ]] || die "source directory not found: ${SOURCE_DIR}"
  SOURCE_DIR="$(CDPATH= cd -- "${SOURCE_DIR}" && pwd -P)"
  log "verifying source checkout ${SOURCE_DIR}"
  verify_source "${SOURCE_DIR}"
else
  SOURCE_DIR="${WORK_ROOT}/upstream"
  log "fetching ${UPSTREAM_TAG} from ${UPSTREAM_REPOSITORY}"
  git init --quiet "${SOURCE_DIR}"
  git -C "${SOURCE_DIR}" remote add origin "${UPSTREAM_REPOSITORY}"
  git -C "${SOURCE_DIR}" fetch --quiet --depth=1 origin \
    "refs/tags/${UPSTREAM_TAG}:refs/tags/${UPSTREAM_TAG}"

  TAG_COMMIT="$(git -C "${SOURCE_DIR}" rev-parse "refs/tags/${UPSTREAM_TAG}^{commit}")"
  [[ "${TAG_COMMIT}" == "${UPSTREAM_COMMIT}" ]] \
    || die "${UPSTREAM_TAG} resolved to ${TAG_COMMIT}; expected ${UPSTREAM_COMMIT}"

  git -C "${SOURCE_DIR}" checkout --quiet --detach "${UPSTREAM_COMMIT}"
  verify_source "${SOURCE_DIR}"
fi

log 'exporting verified upstream source into isolated temporary storage'
mkdir -p -- "${STAGED_SOURCE}"
git -C "${SOURCE_DIR}" archive --format=tar "${UPSTREAM_COMMIT}" \
  | tar -xf - -C "${STAGED_SOURCE}"

PATCH_COUNT=0
if [[ -d "${PATCH_DIR}" ]]; then
  while IFS= read -r -d '' PATCH_FILE; do
    log "applying patch $(basename -- "${PATCH_FILE}")"
    patch --batch --forward --fuzz=0 -d "${STAGED_SOURCE}" -p1 <"${PATCH_FILE}"
    ((PATCH_COUNT += 1))
  done < <(find "${PATCH_DIR}" -maxdepth 1 -type f -name '*.patch' -print0 | LC_ALL=C sort -z)
fi
log "applied ${PATCH_COUNT} owned patch(es)"

if [[ -n "${CARGO_CACHE_DIR}" ]]; then
  CARGO_CACHE_DIR="$(canonicalize_directory "${CARGO_CACHE_DIR}")"
else
  CARGO_CACHE_DIR="${WORK_ROOT}/cargo-home"
  mkdir -p -- "${CARGO_CACHE_DIR}"
fi

case "${CARGO_CACHE_DIR}" in
  /|"${REPO_ROOT}"|"${HOME:-/path-that-cannot-match}")
    die 'Cargo cache must be a dedicated directory, not /, the repository, or home'
    ;;
esac

[[ ! -e "${CARGO_CACHE_DIR}/credentials" \
   && ! -e "${CARGO_CACHE_DIR}/credentials.toml" ]] \
  || die "refusing to mount Cargo credentials from ${CARGO_CACHE_DIR}"

if [[ "${SKIP_FETCH}" == false ]]; then
  log "pulling immutable builder ${PINNED_IMAGE}"
  podman pull --quiet --platform "${BUILDER_PLATFORM}" "${PINNED_IMAGE}" >/dev/null

  log 'hydrating the isolated Cargo cache (network-enabled fetch phase)'
  podman run --rm \
    --pull=never \
    --platform "${BUILDER_PLATFORM}" \
    --network=slirp4netns \
    --cap-drop=all \
    --security-opt=no-new-privileges \
    --env CARGO_HOME=/cargo-home \
    --env CARGO_TERM_COLOR=never \
    --env "RUSTUP_TOOLCHAIN=${RUST_VERSION}" \
    --volume "${STAGED_SOURCE}:/work:ro,Z" \
    --volume "${CARGO_CACHE_DIR}:/cargo-home:rw,Z" \
    --workdir /work \
    "${PINNED_IMAGE}" \
    cargo fetch --locked
else
  podman image exists "${PINNED_IMAGE}" \
    || die "pinned builder image is not local: ${PINNED_IMAGE}"
  [[ -d "${CARGO_CACHE_DIR}/registry" ]] \
    || die "Cargo cache is not hydrated: ${CARGO_CACHE_DIR}"
  log 'fetch phase skipped; all remaining work is offline'
fi

log 'building the facade with networking disabled'
podman run --rm \
  --pull=never \
  --platform "${BUILDER_PLATFORM}" \
  --network=none \
  --cap-drop=all \
  --security-opt=no-new-privileges \
  --env CARGO_HOME=/cargo-home \
  --env CARGO_NET_OFFLINE=true \
  --env CARGO_TERM_COLOR=never \
  --env "EXPECTED_EMSCRIPTEN=${EMSCRIPTEN_VERSION}" \
  --env "EXPECTED_RUST=${RUST_VERSION}" \
  --env "RUSTUP_TOOLCHAIN=${RUST_VERSION}" \
  --volume "${STAGED_SOURCE}:/work:rw,Z" \
  --volume "${CARGO_CACHE_DIR}:/cargo-home:rw,Z" \
  --workdir /work \
  "${PINNED_IMAGE}" \
  bash -ceu '
    read -r _ actual_rust _ <<<"$(rustc --version)"
    case "${actual_rust}" in
      "${EXPECTED_RUST}"|"${EXPECTED_RUST}."*) ;;
      *) echo "unexpected Rust version: ${actual_rust}" >&2; exit 1 ;;
    esac

    actual_emcc="$(emcc --version | head -n 1)"
    case "${actual_emcc}" in
      *" ${EXPECTED_EMSCRIPTEN} "*|*" ${EXPECTED_EMSCRIPTEN}" ) ;;
      *) echo "unexpected Emscripten version: ${actual_emcc}" >&2; exit 1 ;;
    esac

    rm -rf /work/occt/build /work/3rdparty
    mkdir -p /work/occt
    cp -a /workspace/occt/build /work/occt/build
    cp -a /workspace/3rdparty /work/3rdparty

    cargo run --locked --offline --release --package xtask -- build --release
  '

[[ -s "${STAGED_SOURCE}/dist/occt-wasm.js" ]] \
  || die 'build did not produce dist/occt-wasm.js'
[[ -s "${STAGED_SOURCE}/dist/occt-wasm.wasm" ]] \
  || die 'build did not produce dist/occt-wasm.wasm'

mkdir -p -- "${ARTIFACTS_ROOT}"
ARTIFACT_TEMP="$(mktemp -d "${ARTIFACTS_ROOT}/.occt-facade.XXXXXXXX")"
install -m 0644 "${STAGED_SOURCE}/dist/occt-wasm.js" \
  "${ARTIFACT_TEMP}/occt-wasm.js"
install -m 0644 "${STAGED_SOURCE}/dist/occt-wasm.wasm" \
  "${ARTIFACT_TEMP}/occt-wasm.wasm"
(
  cd "${ARTIFACT_TEMP}"
  LC_ALL=C sha256sum occt-wasm.js occt-wasm.wasm >SHA256SUMS
)

[[ ! -L "${OUTPUT_DIR}" ]] || die "refusing to replace symlink: ${OUTPUT_DIR}"
rm -rf -- "${OUTPUT_DIR}"
mv -- "${ARTIFACT_TEMP}" "${OUTPUT_DIR}"
ARTIFACT_TEMP=""

log "facade artifacts written to ${OUTPUT_DIR}"
sed 's/^/[occt-facade] sha256 /' "${OUTPUT_DIR}/SHA256SUMS" >&2
