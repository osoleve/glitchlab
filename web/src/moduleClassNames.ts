type CssModule = Readonly<Record<string, string>>;
type ClassValue = string | false | null | undefined;

export function moduleClassNames(styles: CssModule, ...values: ClassValue[]): string {
  return values
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/\s+/))
    .map((name) => styles[name] ?? name)
    .join(" ");
}
