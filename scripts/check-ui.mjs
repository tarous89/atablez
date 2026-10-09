import { chromium } from "playwright";
process.env.TEST_MODE = "1";
process.env.TEST_DB = "memory";
const { createApp } = await import("../server/index.ts");
const instance = await createApp();
const http = instance.app.listen(3000, "0.0.0.0");
await new Promise((r) => http.once("listening", r));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-zygote",
    "--single-process",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3000");
await page.getByText("Explore a sample table").click();
await page.getByLabel("Table name", { exact: true }).waitFor();
await page.getByLabel("Table name", { exact: true }).fill("Supplier research");
await page.getByLabel("Table name", { exact: true }).press("Enter");
await page.getByText("All changes saved").waitFor();
await page.getByLabel("Price (€)", { exact: true }).first().fill("2500");
await page.getByLabel("Price (€)", { exact: true }).first().press("Enter");
await page.waitForTimeout(300);
await page.reload();
await page.getByRole("button", { name: /Supplier research/ }).click();
if (
  (await page.getByLabel("Price (€)", { exact: true }).first().inputValue()) !==
  "2500"
)
  throw Error("Cell did not persist");
await page.screenshot({ path: "/tmp/atablez-table.png", fullPage: true });
await page.getByRole("button", { name: "Modify table" }).click();
await page.getByLabel("Column 1 name").fill("Supplier");
await page.getByLabel("Column 1 description").fill("Registered supplier name");
await page.getByRole("button", { name: "Save structure" }).click();
await page.getByLabel("Supplier", { exact: true }).first().waitFor();
await page.getByRole("button", { name: "Modify table" }).click();
await page.screenshot({ path: "/tmp/atablez-structure.png", fullPage: true });
await page.getByRole("button", { name: "Close structure" }).click();
await page.getByRole("button", { name: "Sign up", exact: true }).click();
await page
  .getByLabel("Email", { exact: true })
  .fill(`ui-${Date.now()}@example.test`);
await page
  .getByLabel("Password", { exact: true })
  .fill("Long-test-password-123");
await page
  .getByRole("button", { name: "Create account & keep my tables" })
  .click();
await page.getByRole("button", { name: "My account" }).waitFor();
if (await page.locator(".preview").count())
  throw Error("Guest banner remains after signup");
await page.setViewportSize({ width: 520, height: 900 });
await page.screenshot({ path: "/tmp/atablez-mobile.png", fullPage: true });
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "UI checks passed: inline edits, persistence, schema change, signup claim, responsive screenshots; no browser errors",
);
await browser.close();
await new Promise((r) => http.close(r));
await instance.close();
