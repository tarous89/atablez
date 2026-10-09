import { chromium } from "playwright";
import { readFileSync } from "node:fs";
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
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:3000");
  await page.getByText("Explore a sample table").click();
  await page
    .getByLabel("Table name", { exact: true })
    .fill("Ideas for the weekend");
  await page.getByLabel("Table name", { exact: true }).press("Enter");
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.locator('input[aria-label="Progress"]').first().fill("45");
  await page.locator('input[aria-label="Progress"]').first().press("Enter");
  await page.waitForTimeout(250);
  await page.reload();
  await page.getByRole("button", { name: /Ideas for the weekend/ }).click();
  if (
    (await page
      .locator('input[aria-label="Progress"]')
      .first()
      .inputValue()) !== "45"
  )
    throw Error("Progress did not persist");
  const columnHandle = page.getByRole("separator", {
    name: "Resize Idea",
    exact: true,
  });
  const box = await columnHandle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + 12);
  await page.mouse.up();
  await page.getByText("Saved", { exact: true }).waitFor();
  const rowHandle = page
    .getByRole("separator", { name: "Resize row height", exact: true })
    .first();
  await rowHandle.focus();
  await rowHandle.press("ArrowDown");
  await page.waitForTimeout(200);
  await page.reload();
  await page.getByRole("button", { name: /Ideas for the weekend/ }).click();
  if (
    (await page
      .getByRole("separator", { name: "Resize Idea", exact: true })
      .getAttribute("aria-valuenow")) !== "280"
  )
    throw Error("Column resize did not persist");
  if (
    (await page
      .getByRole("separator", { name: "Resize row height", exact: true })
      .first()
      .getAttribute("aria-valuenow")) !== "60"
  )
    throw Error("Row resize did not persist");
  await page.screenshot({ path: "/tmp/atablez-table.png", fullPage: true });
  await page.getByLabel("Table actions").click();
  await page.getByRole("button", { name: "Modify table" }).click();
  await page.getByLabel("Column 1 name").fill("Plan");
  await page.getByRole("button", { name: "Save structure" }).click();
  await page.getByLabel("Plan", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Keep my tables" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("ui-" + Date.now() + "@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Long-test-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Share", exact: true }).waitFor();
  if (await page.locator(".preview").count())
    throw Error("Preview notice remains");
  // Reproduce chat-specific overrides before editing the same table in Settings.
  const browserToken = await page.evaluate(() =>
    sessionStorage.getItem("atablez.auth"),
  );
  const principal = await instance.s.identify(browserToken);
  const workspace = await instance.s.view(principal.workspace_id);
  const chatToken = await instance.s.credential(
    instance.s.query,
    principal.workspace_id,
    "access",
    3600000,
    "ui-test",
  );
  const chatChange = await fetch("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer " + chatToken,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "change_table",
        arguments: {
          action: "appearance",
          tableId: workspace.tables[0].id,
          appearance: { rowHeight: 156, tableHeight: 600 },
          revision: workspace.revision,
          requestId: crypto.randomUUID(),
        },
      },
    }),
  });
  if ((await chatChange.json()).result.isError)
    throw Error("Chat appearance setup failed");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Resize row height"]')
        ?.getAttribute("aria-valuenow") === "156",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Usage", exact: true }).waitFor();
  if (
    (await page
      .getByRole("progressbar", { name: "files usage" })
      .getAttribute("max")) !== String(20 * 1048576)
  )
    throw Error("Incorrect file allowance");
  await page.screenshot({
    path: "/tmp/atablez-general-v3.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  if (
    (await page.getByLabel("Appearance scope").inputValue()) !==
    workspace.tables[0].id
  )
    throw Error("Settings failed to target the current table");
  if (
    (await page.getByLabel("Row height", { exact: true }).inputValue()) !==
    "156"
  )
    throw Error("Settings failed to show chat row height");
  await page.getByLabel("Table height", { exact: true }).fill("400");
  await page.getByLabel("Table height", { exact: true }).press("Enter");
  await page.getByText("Table appearance saved", { exact: true }).waitFor();
  await page.getByLabel("Row height", { exact: true }).fill("9999");
  await page.getByLabel("Row height", { exact: true }).press("Enter");
  await page
    .getByRole("alert")
    .filter({ hasText: "Enter a whole number" })
    .waitFor();
  await page
    .getByLabel("Appearance scope")
    .selectOption({ label: "Ideas for the weekend" });
  await page.getByLabel("Row height", { exact: true }).fill("104");
  await page.getByLabel("Row height", { exact: true }).press("Enter");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Rule column").selectOption("progress");
  await page.getByLabel("Rule value").fill("50");
  await page.getByRole("button", { name: "Save rules", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: "/tmp/atablez-workspace-v3.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.getByLabel("Team name", { exact: true }).fill("Family");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await page.getByLabel("Rename team").waitFor();
  await page.screenshot({ path: "/tmp/atablez-settings.png", fullPage: true });
  await page.reload();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByRole("button", { name: /Ideas for the weekend/ }).click();
  if (
    (await page
      .getByRole("separator", { name: "Resize row height", exact: true })
      .first()
      .getAttribute("aria-valuenow")) !== "104"
  )
    throw Error("Settings row height did not persist");
  if (
    (await page
      .getByRole("separator", { name: "Resize table height", exact: true })
      .getAttribute("aria-valuenow")) !== "400"
  )
    throw Error("Settings failed to replace chat table height");
  const barColor = await page
    .locator(".progress-track > span")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  if (barColor !== "rgb(220, 38, 38)")
    throw Error("Conditional progress color not applied: " + barColor);
  await page.getByLabel("Table actions").click();
  await page.getByRole("button", { name: "Modify table" }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.getByLabel("Column 6 name").fill("Photo");
  await page.getByLabel("Column 6 type").selectOption("image");
  await page.getByRole("button", { name: "Save structure" }).click();
  await page
    .getByLabel("Upload Photo")
    .first()
    .setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZWkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.locator(".thumbnail img").first().waitFor();
  if (
    !(await page
      .locator(".thumbnail img")
      .first()
      .evaluate((x) => x.complete && x.naturalWidth > 0))
  )
    throw Error("Image preview failed");
  await page.setViewportSize({ width: 520, height: 900 });
  await page.screenshot({ path: "/tmp/atablez-mobile.png", fullPage: true });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    )
  )
    throw Error("Page overflow");
  // Exercise the same bundle in a sandboxed MCP host without native modals.
  const browserAuth = await page.evaluate(() =>
    sessionStorage.getItem("atablez.auth"),
  );
  const credential = await instance.s.identify(browserAuth);
  const token = await instance.s.credential(
    instance.s.query,
    credential.workspace_id,
    "access",
    3600000,
    "test-host",
  );
  const state = await instance.s.view(credential.workspace_id);
  const tool = await fetch("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_workspace",
        arguments: { tableId: state.tables[0].id },
      },
    }),
  }).then((r) => r.json());
  await page.route("**/test-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><body style="margin:0"><iframe id="widget" sandbox="allow-scripts allow-same-origin allow-downloads allow-forms" style="width:520px;height:900px;border:0"></iframe></body>',
    }),
  );
  await page.goto("http://localhost:3000/test-host");
  const html = readFileSync("dist/index.html", "utf8").replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src http://localhost:3000; img-src blob:; font-src 'none';">`,
  );
  await page.evaluate(
    ({ html, result }) => {
      const frame = document.getElementById("widget");
      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow) return;
        const m = event.data;
        if (m.method === "ui/initialize")
          frame.contentWindow.postMessage(
            {
              jsonrpc: "2.0",
              id: m.id,
              result: {
                protocolVersion: m.params.protocolVersion,
                hostInfo: { name: "Test host", version: "1.0" },
                hostCapabilities: { openLinks: {}, downloadFile: {} },
                hostContext: {
                  theme: "light",
                  displayMode: "inline",
                  containerDimensions: { width: 520 },
                },
              },
            },
            "*",
          );
        if (m.method === "ui/notifications/initialized")
          frame.contentWindow.postMessage(
            {
              jsonrpc: "2.0",
              method: "ui/notifications/tool-result",
              params: result,
            },
            "*",
          );
        if (m.method === "ui/open-link") {
          window.lastOpen = m.params.url;
          frame.contentWindow.postMessage(
            { jsonrpc: "2.0", id: m.id, result: {} },
            "*",
          );
        }
        if (m.method === "ui/download-file") {
          window.lastDownload = m.params;
          frame.contentWindow.postMessage(
            { jsonrpc: "2.0", id: m.id, result: {} },
            "*",
          );
        }
      });
      frame.srcdoc = html;
    },
    { html, result: tool.result },
  );
  const frame = page.frameLocator("#widget");
  await frame.getByLabel("Table name", { exact: true }).waitFor();
  await frame.locator(".thumbnail img").first().waitFor();
  if (
    !(await frame
      .locator(".thumbnail img")
      .first()
      .evaluate((x) => x.complete && x.naturalWidth > 0))
  )
    throw Error("Sandbox image did not load");
  await frame.getByLabel("Table actions").click();
  await frame.getByRole("button", { name: "Export CSV", exact: true }).click();
  await page.waitForFunction(() => !!window.lastDownload);
  await frame.getByRole("button", { name: "Open entry" }).first().click();
  await frame.getByRole("button", { name: "Delete row", exact: true }).click();
  await frame.getByRole("alertdialog").waitFor();
  await frame
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await frame.getByRole("button", { name: "Close dialog" }).click();
  await frame.getByRole("button", { name: "Settings", exact: true }).click();
  await frame.getByRole("button", { name: "Open in app" }).click();
  if (
    (await page.evaluate(() => window.lastOpen)) !==
    "http://localhost:3000/settings"
  )
    throw Error("Settings did not open app route");
  await frame.getByRole("button", { name: "Tables", exact: true }).click();
  await frame.getByRole("button", { name: /Ideas for the weekend/ }).click();
  await frame.getByLabel("Table actions").click();
  await frame.getByRole("button", { name: "Modify table" }).click();
  await frame
    .getByRole("button", { name: "Delete table", exact: true })
    .click();
  await frame
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await frame
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await frame.getByRole("button", { name: /Ideas for the weekend/ }).waitFor();
  console.log(
    "Sandbox host passed: tool hydration, scoped API, blob image CSP, native-free confirmation, host CSV download and settings link.",
  );
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "UI passed: inline edit, progress persistence, structure, signup claim, settings direct route, teams, image upload and narrow viewport.",
  );
} finally {
  await browser.close();
  await new Promise((r) => http.close(r));
  await instance.close();
}
