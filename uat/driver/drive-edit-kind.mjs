import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = "uat/runs/2026-08-07-intake-recertify/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "cs-CZ", viewport: { width: 1440, height: 900 } });
await context.addCookies([
  { name: "kp_entered", value: "1", url: BASE_URL },
  { name: "NEXT_LOCALE", value: "cs", url: BASE_URL },
]);
const page = await context.newPage();
await page.goto(BASE_URL + "/?tab=library", { waitUntil: "domcontentloaded" });
await sleep(2500);
await page.getByText("Zadání role", { exact: false }).first().click();
await sleep(1500);
await page.getByRole("button").filter({ hasText: "Senior Java vývojář" }).filter({ hasText: "Probíhá" }).first().click();
await sleep(2000);
await page.screenshot({ path: `${SHOT_DIR}/F-01-before-edit.png`, fullPage: true });
await page.getByRole("button", { name: /Upravit zadání/i }).first().click();
await sleep(600);
// Find the requirement row whose skill input holds "Kafka" and flip its kind select.
const rowIdx = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input")];
  return inputs.findIndex((i) => i.value === "Kafka");
});
console.log(JSON.stringify({ kafkaInputIndex: rowIdx }));
const kafkaInput = page.locator("input").nth(rowIdx);
const kindSelect = kafkaInput.locator("xpath=following-sibling::select[1]");
await kindSelect.selectOption("must_have");
await page.screenshot({ path: `${SHOT_DIR}/F-02-edit-kind-flipped.png`, fullPage: true });
await page.getByRole("button", { name: /Uložit změny/i }).first().click();
await sleep(2000);
await page.screenshot({ path: `${SHOT_DIR}/F-03-after-save.png`, fullPage: true });
const txt = await page.locator("body").innerText();
const nez = txt.slice(txt.indexOf("NEZBYTNÉ"), txt.indexOf("KONTEXT"));
console.log(JSON.stringify({ kafkaNowMust: nez.includes("Kafka"), section: nez.replace(/\n/g, " | ").slice(0, 300) }));
await browser.close();
