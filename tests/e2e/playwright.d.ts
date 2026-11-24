// Playwright is a tool in the build environment, not a dependency (TECH-SPEC 3.1, 13.3),
// so it has no types in node_modules. These are the few parts browser-night.ts uses.
declare module "playwright" {
  export interface Page {
    on(event: "pageerror", fn: (e: Error) => void): void;
    on(event: "console", fn: (m: { type(): string; text(): string }) => void): void;
    on(event: "requestfailed", fn: (r: { url(): string; failure(): { errorText: string } | null }) => void): void;
    on(event: "response", fn: (r: { url(): string; status(): number }) => void): void;
    goto(url: string): Promise<unknown>;
    screenshot(opts: { path: string }): Promise<unknown>;
    waitForFunction<A>(fn: (arg: A) => boolean, arg?: A, opts?: { timeout?: number }): Promise<unknown>;
    waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
    fill(selector: string, value: string): Promise<void>;
    click(selector: string): Promise<void>;
    press(selector: string, key: string): Promise<void>;
    textContent(selector: string): Promise<string | null>;
    // used by review-fixes-browser.ts
    evaluate<R>(fn: () => R): Promise<R>;
    inputValue(selector: string): Promise<string>;
    locator(selector: string): Locator;
    route(url: string, handler: (route: Route) => Promise<void> | void): Promise<void>;
  }
  export interface Locator {
    locator(selector: string): Locator;
    click(): Promise<void>;
  }
  export interface Route {
    request(): { method(): string };
    continue(): Promise<void>;
  }
  export interface BrowserContext {
    newPage(): Promise<Page>;
    addCookies(cookies: { name: string; value: string; url: string }[]): Promise<void>;
  }
  export interface Browser {
    newContext(opts?: { viewport?: { width: number; height: number }; isMobile?: boolean; hasTouch?: boolean }): Promise<BrowserContext>;
    close(): Promise<void>;
  }
  export const chromium: { launch(): Promise<Browser> };
}
