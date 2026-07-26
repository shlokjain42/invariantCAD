import { describe, expect, it } from "vitest";
import {
  DEFAULT_OCCT_STEP_METADATA_LIMITS,
  OCCT_STEP_METADATA_TIMESTAMP,
  rewriteOcctStepMetadata,
  rewriteOcctStepMetadataFromSource,
  type OcctStepMetadata,
  type OcctStepMetadataLimits,
} from "../src/internal/occt-step-metadata.js";

const METADATA: OcctStepMetadata = Object.freeze({
  fileName: "deterministic'gear.step",
  timestamp: OCCT_STEP_METADATA_TIMESTAMP,
  productId: "gear'id",
  productName: "Gear 'A'",
  productDescription: "A deterministic product",
});

const HEADER_FILE_NAME =
  "FILE_NAME('old''file.step','2026-07-26T12:34:56'," +
  "('Author'),('Organization'),'OCCT processor','OCCT system','approved');";
const HEADER_FILE_SCHEMA =
  "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));";

function stepDocument(
  headerRecords: readonly string[] = [
    "FILE_DESCRIPTION(('PRODUCT(''header decoy'')'),'2;1');",
    "/* FILE_NAME('comment decoy') */",
    HEADER_FILE_NAME,
    HEADER_FILE_SCHEMA,
  ],
  dataRecords: readonly string[] = [
    "#1 = APPLICATION_CONTEXT('PRODUCT(''string decoy'')');",
    "#2 = PRODUCT('old-id','old name','old description',(#3));",
    "#3 = PRODUCT_CONTEXT('old name',#1,'mechanical');",
  ],
): string {
  return [
    "/* leading PRODUCT and FILE_NAME decoys */",
    "ISO-10303-21;",
    "HEADER;",
    ...headerRecords,
    "ENDSEC;",
    "DATA;",
    ...dataRecords,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "/* trailing decoy */",
  ].join("\r\n");
}

function rewrite(
  source: string,
  limits?: OcctStepMetadataLimits,
  signal?: AbortSignal,
): string {
  return rewriteOcctStepMetadata(source, {
    metadata: METADATA,
    ...(limits === undefined ? {} : { limits }),
    ...(signal === undefined ? {} : { signal }),
  });
}

describe("bounded OCCT STEP metadata rewrite", () => {
  it("replaces only the exact FILE_NAME and PRODUCT string tokens", () => {
    const source = stepDocument();
    const expected = stepDocument(
      [
        "FILE_DESCRIPTION(('PRODUCT(''header decoy'')'),'2;1');",
        "/* FILE_NAME('comment decoy') */",
        "FILE_NAME('deterministic''gear.step'," +
          `'${OCCT_STEP_METADATA_TIMESTAMP}',` +
          "('Author'),('Organization'),'OCCT processor','OCCT system','approved');",
        HEADER_FILE_SCHEMA,
      ],
      [
        "#1 = APPLICATION_CONTEXT('PRODUCT(''string decoy'')');",
        "#2 = PRODUCT('gear''id','Gear ''A'''," +
          "'A deterministic product',(#3));",
        "#3 = PRODUCT_CONTEXT('old name',#1,'mechanical');",
      ],
    );

    expect(rewrite(source)).toBe(expected);
    expect(OCCT_STEP_METADATA_TIMESTAMP).toBe("1970-01-01T00:00:00");
  });

  it("handles trivia, escaped apostrophes, nested lists, and complex entities", () => {
    const source = stepDocument(
      [
        "FILE_DESCRIPTION(('keep /* text */ and '' quotes'),'2;1');",
        "FILE_NAME /* gap */ ( /* a */ 'old''name' /* b */ ," +
          " 'old-time',('A, B'),('C'),'P','S','A');",
        HEADER_FILE_SCHEMA,
      ],
      [
        "#1=(REPRESENTATION_CONTEXT('PRODUCT(''decoy'')','x')" +
          "GLOBAL_UNIT_ASSIGNED_CONTEXT((#4)));",
        "#2=(PRODUCT /* gap */ ('id','name','description',(#3))" +
          "PRODUCT_DEFINITION_FORMATION('','',#3));",
      ],
    );
    const output = rewrite(source);

    expect(output).toContain(
      "FILE_NAME /* gap */ ( /* a */ 'deterministic''gear.step' /* b */ ," +
        " '1970-01-01T00:00:00',('A, B'),('C'),'P','S','A');",
    );
    expect(output).toContain(
      "#2=(PRODUCT /* gap */ ('gear''id','Gear ''A'''," +
        "'A deterministic product',(#3))" +
        "PRODUCT_DEFINITION_FORMATION('','',#3));",
    );
    expect(output).toContain("'PRODUCT(''decoy'')'");
  });

  it("rejects missing, repeated, misplaced, and malformed target records", () => {
    const validProduct = "#1=PRODUCT('id','name','description',(#2));";
    const cases: readonly [string, string][] = [
      [
        stepDocument(
          ["FILE_DESCRIPTION(('x'),'2;1');", HEADER_FILE_SCHEMA],
          [validProduct],
        ),
        "missing HEADER FILE_NAME",
      ],
      [
        stepDocument([HEADER_FILE_NAME, HEADER_FILE_NAME], [validProduct]),
        "multiple HEADER FILE_NAME",
      ],
      [
        stepDocument([HEADER_FILE_NAME], [validProduct]),
        "missing HEADER FILE_SCHEMA",
      ],
      [
        stepDocument(
          [
            HEADER_FILE_NAME,
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
          ],
          [validProduct],
        ),
        "supported AP214IS profile",
      ],
      [
        stepDocument(
          [
            HEADER_FILE_NAME,
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'," +
              "'EXTRA'));",
          ],
          [validProduct],
        ),
        "supported AP214IS profile",
      ],
      [
        stepDocument(
          [HEADER_FILE_NAME, HEADER_FILE_SCHEMA, HEADER_FILE_SCHEMA],
          [validProduct],
        ),
        "multiple HEADER FILE_SCHEMA",
      ],
      [
        stepDocument(
          [HEADER_FILE_NAME, HEADER_FILE_SCHEMA],
          ["#1=APPLICATION_CONTEXT('x');"],
        ),
        "missing DATA PRODUCT",
      ],
      [
        stepDocument(
          [HEADER_FILE_NAME, HEADER_FILE_SCHEMA],
          [
            validProduct,
            "#2=PRODUCT('id-2','name-2','description-2',(#3));",
          ],
        ),
        "multiple DATA PRODUCT",
      ],
      [
        stepDocument(
          [
            "FILE_NAME($,'time',('A'),('O'),'P','S','A');",
            HEADER_FILE_SCHEMA,
          ],
          [validProduct],
        ),
        "FILE_NAME argument 0",
      ],
      [
        stepDocument(
          [
            "FILE_NAME('name','time',('A'),('O'),'P','S');",
            HEADER_FILE_SCHEMA,
          ],
          [validProduct],
        ),
        "FILE_NAME must have exactly 7",
      ],
      [
        stepDocument(
          [HEADER_FILE_NAME, HEADER_FILE_SCHEMA],
          ["#1=PRODUCT('id',$,'description',(#2));"],
        ),
        "PRODUCT argument 1",
      ],
      [
        stepDocument(
          [HEADER_FILE_NAME, HEADER_FILE_SCHEMA],
          ["#1=PRODUCT('id','name','description');"],
        ),
        "PRODUCT must have exactly 4",
      ],
      [
        stepDocument(
          [
            HEADER_FILE_NAME,
            HEADER_FILE_SCHEMA,
            "PRODUCT('id','name','description',(#2));",
          ],
          [validProduct],
        ),
        "PRODUCT is only valid in DATA",
      ],
      [
        stepDocument(
          [HEADER_FILE_NAME, HEADER_FILE_SCHEMA],
          [
            "#1=FILE_NAME('name','time',('A'),('O'),'P','S','A');",
            validProduct,
          ],
        ),
        "FILE_NAME is only valid in HEADER",
      ],
    ];

    for (const [source, message] of cases) {
      expect(() => rewrite(source), message).toThrow(message);
    }
  });

  it("rejects malformed exchange structures and lexical traps", () => {
    const cases: readonly [string, string][] = [
      [stepDocument().slice(1), "expected ISO-10303-21"],
      [
        stepDocument().slice(0, -1),
        "unterminated comment",
      ],
      [
        stepDocument(
          [
            "FILE_NAME('line\nbreak','time',('A'),('O'),'P','S','A');",
            HEADER_FILE_SCHEMA,
          ],
          ["#1=PRODUCT('id','name','description',(#2));"],
        ),
        "control character in STEP string",
      ],
      [
        stepDocument(
          [HEADER_FILE_NAME, HEADER_FILE_SCHEMA],
          ["#1=PRODUCT('id','name','description',(#2);"],
        ),
        "structural punctuation",
      ],
      [
        `${stepDocument()}\r\n#99=PRODUCT('x','x','x',(#1));`,
        "trailing content",
      ],
    ];

    for (const [source, message] of cases) {
      expect(() => rewrite(source), message).toThrow(message);
    }
  });

  it("encodes Unicode scalars and reverse solidus with Part-21 escapes", () => {
    const metadata: OcctStepMetadata = {
      fileName: "café\\gear.step",
      timestamp: OCCT_STEP_METADATA_TIMESTAMP,
      productId: "轴'1",
      productName: "Gear 😀",
      productDescription: "Ω\\datum",
    };
    const output = rewriteOcctStepMetadata(stepDocument(), { metadata });

    expect(output).toContain(
      String.raw`'caf\X2\00E9\X0\\X2\005C\X0\gear.step'`,
    );
    expect(output).toContain(
      String.raw`PRODUCT('\X2\8F74\X0\''1','Gear \X4\0001F600\X0\','\X2\03A9\X0\\X2\005C\X0\datum'`,
    );

    const metadataBytes = Object.values(metadata).reduce(
      (total, field) => total + new TextEncoder().encode(field).byteLength,
      0,
    );
    expect(
      rewriteOcctStepMetadata(stepDocument(), {
        metadata,
        limits: { maxMetadataUtf8Bytes: metadataBytes },
      }),
    ).toBe(output);
    expect(() =>
      rewriteOcctStepMetadata(stepDocument(), {
        metadata,
        limits: { maxMetadataUtf8Bytes: metadataBytes - 1 },
      }),
    ).toThrow("maxMetadataUtf8Bytes");
  });

  it("rejects controls, unpaired surrogates, and invalid metadata shapes", () => {
    const source = stepDocument();
    const badValues: readonly [keyof OcctStepMetadata, unknown][] = [
      ["productId", "line\nbreak"],
      ["productDescription", "\u0000"],
      ["fileName", "delete\u007f.step"],
      ["productName", "next-line\u0085"],
      ["productName", "unpaired-high\ud800"],
      ["productDescription", "unpaired-low\udc00"],
      ["timestamp", "2026-02-29T00:00:00"],
      ["timestamp", "0000-01-01T00:00:00"],
      ["timestamp", "2026-01-01T24:00:00"],
      ["fileName", 42],
    ];

    for (const [key, value] of badValues) {
      expect(() =>
        rewriteOcctStepMetadata(source, {
          metadata: { ...METADATA, [key]: value } as OcctStepMetadata,
        }),
      ).toThrow(key);
    }
    expect(() =>
      rewriteOcctStepMetadata(source, {
        metadata: null as unknown as OcctStepMetadata,
      }),
    ).toThrow(TypeError);
  });

  it("stops apostrophe-heavy metadata at the cumulative authored-byte budget", () => {
    const metadata: OcctStepMetadata = {
      ...METADATA,
      productDescription: "'".repeat(250_000),
    };
    const bytesBeforeDescription =
      new TextEncoder().encode(METADATA.fileName).byteLength +
      new TextEncoder().encode(METADATA.timestamp).byteLength +
      new TextEncoder().encode(METADATA.productId).byteLength +
      new TextEncoder().encode(METADATA.productName).byteLength;

    expect(() =>
      rewriteOcctStepMetadata(stepDocument(), {
        metadata,
        limits: {
          maxMetadataUtf8Bytes: bytesBeforeDescription + 8,
        },
      }),
    ).toThrow(
      `maxMetadataUtf8Bytes ${bytesBeforeDescription + 8}`,
    );
  });

  it("validates metadata before invoking a synchronous source writer", () => {
    let sourceCalls = 0;
    const source = (): string => {
      sourceCalls += 1;
      return stepDocument();
    };

    expect(() =>
      rewriteOcctStepMetadataFromSource(source, {
        metadata: {
          ...METADATA,
          timestamp: "2026-02-29T00:00:00",
        },
      }),
    ).toThrow("timestamp");
    expect(sourceCalls).toBe(0);

    expect(
      rewriteOcctStepMetadataFromSource(source, {
        metadata: METADATA,
      }),
    ).toBe(rewrite(stepDocument()));
    expect(sourceCalls).toBe(1);
  });

  it("enforces every positive safe-integer limit at exact boundaries", () => {
    const source = stepDocument();
    const output = rewrite(source);
    const outputBytes = new TextEncoder().encode(output).byteLength;
    const metadataBytes =
      METADATA.fileName.length +
      METADATA.timestamp.length +
      METADATA.productId.length +
      METADATA.productName.length +
      METADATA.productDescription.length;
    const exactLimits: OcctStepMetadataLimits = {
      maxInputCodeUnits: source.length,
      maxOutputUtf8Bytes: outputBytes,
      maxScanUnits: source.length,
      maxEntityCount: 3,
      maxMetadataUtf8Bytes: metadataBytes,
    };

    expect(rewrite(source, exactLimits)).toBe(output);
    expect(() =>
      rewrite(source, {
        ...exactLimits,
        maxInputCodeUnits: source.length - 1,
      }),
    ).toThrow("maxInputCodeUnits");
    expect(() =>
      rewrite(source, {
        ...exactLimits,
        maxOutputUtf8Bytes: outputBytes - 1,
      }),
    ).toThrow("maxOutputUtf8Bytes");
    expect(() =>
      rewrite(source, {
        ...exactLimits,
        maxScanUnits: source.length - 1,
      }),
    ).toThrow("maxScanUnits");
    expect(() =>
      rewrite(source, {
        ...exactLimits,
        maxEntityCount: 2,
      }),
    ).toThrow("maxEntityCount");
    expect(() =>
      rewrite(source, {
        ...exactLimits,
        maxMetadataUtf8Bytes: metadataBytes - 1,
      }),
    ).toThrow("maxMetadataUtf8Bytes");

    for (const key of Object.keys(
      DEFAULT_OCCT_STEP_METADATA_LIMITS,
    ) as (keyof OcctStepMetadataLimits)[]) {
      for (const invalid of [0, -1, 1.5, Number.NaN, Number.MAX_VALUE]) {
        expect(() =>
          rewrite(source, { [key]: invalid }),
        ).toThrow(RangeError);
      }
    }
  });

  it("counts source Unicode exactly for the output UTF-8 ceiling", () => {
    const source = stepDocument([
      "FILE_DESCRIPTION(('preserve 😀'),'2;1');",
      HEADER_FILE_NAME,
      HEADER_FILE_SCHEMA,
    ]);
    const output = rewrite(source);
    const bytes = new TextEncoder().encode(output).byteLength;

    expect(
      rewrite(source, { maxOutputUtf8Bytes: bytes }),
    ).toBe(output);
    expect(() =>
      rewrite(source, { maxOutputUtf8Bytes: bytes - 1 }),
    ).toThrow("maxOutputUtf8Bytes");
  });

  it("scans many non-target strings without charging the metadata budget", () => {
    const decoys = new Array(20_000).fill("'decoy'").join(",");
    const source = stepDocument(
      undefined,
      [
        `#1=APPLICATION_CONTEXT((${decoys}));`,
        "#2=PRODUCT('id','name','description',(#3));",
        "#3=PRODUCT_CONTEXT('name',#1,'mechanical');",
      ],
    );
    const output = rewrite(source);
    const metadataBytes = Object.values(METADATA).reduce(
      (total, field) => total + new TextEncoder().encode(field).byteLength,
      0,
    );

    expect(
      rewrite(source, {
        maxInputCodeUnits: source.length,
        maxOutputUtf8Bytes: new TextEncoder().encode(output).byteLength,
        maxScanUnits: source.length,
        maxEntityCount: 3,
        maxMetadataUtf8Bytes: metadataBytes,
      }),
    ).toBe(output);
  });

  it("uses the native AbortSignal state without invoking shadow properties", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => rewrite(stepDocument(), undefined, controller.signal)).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );

    let shadowReads = 0;
    Object.defineProperty(controller.signal, "aborted", {
      configurable: true,
      get() {
        shadowReads += 1;
        return false;
      },
    });
    let sourceCalls = 0;
    expect(() =>
      rewriteOcctStepMetadataFromSource(
        () => {
          sourceCalls += 1;
          return stepDocument();
        },
        {
          metadata: METADATA,
          signal: controller.signal,
        },
      ),
    ).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
    expect(shadowReads).toBe(0);
    expect(sourceCalls).toBe(0);
  });

  it("ignores inherited options and uses captured helper intrinsics", () => {
    const controller = new AbortController();
    controller.abort();
    const pushDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "push",
    );
    if (pushDescriptor === undefined) {
      throw new Error("Array.prototype.push descriptor is unavailable");
    }
    let poisonedPushCalls = 0;
    let traps = 0;
    const metadata = new Proxy(METADATA, {
      getOwnPropertyDescriptor(target, property) {
        traps += 1;
        Object.defineProperty(Array.prototype, "push", {
          configurable: true,
          writable: true,
          value() {
            poisonedPushCalls += 1;
            throw new Error("poisoned push invoked");
          },
        });
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    let output = "";
    try {
      Object.defineProperty(Object.prototype, "signal", {
        configurable: true,
        value: controller.signal,
      });
      output = rewriteOcctStepMetadata(stepDocument(), {
        metadata,
      });
    } finally {
      Object.defineProperty(Array.prototype, "push", pushDescriptor);
      Reflect.deleteProperty(Object.prototype, "signal");
    }

    expect(output).toContain("PRODUCT('gear''id','Gear ''A'''");
    expect(traps).toBe(5);
    expect(poisonedPushCalls).toBe(0);
  });
});
