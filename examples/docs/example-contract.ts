export interface DocumentationExample {
  readonly id: string;
  readonly checks: Readonly<Record<string, boolean>>;
}
