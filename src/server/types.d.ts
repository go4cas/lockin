// Bun imports .sql files as text with `with { type: "text" }`.
declare module "*.sql" {
  const text: string;
  export default text;
}
