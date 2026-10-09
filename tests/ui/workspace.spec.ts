import { countText, formatWordCount } from "../../src/lib/word-count";
import {
  builtInSpeechEngines,
  speechTemplateForVoice,
} from "../../src/lib/speech-engines";
import { expect, test, type Page } from "@playwright/test";

// The bridge is isolated to the test browser. No real books, models or credentials are used.
async function mockDesktop(
  page: Page,
  options: {
    empty?: boolean;
    sourceError?: boolean;
    legacy?: boolean;
    manySources?: boolean;
    previewDelay?: boolean;
    preparationMode?: "partial" | "complete" | "legacy-full";
    coverage?: boolean;
    resumePosition?: number;
    downloadFails?: boolean;
    holdDownloadProgress?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({
      empty,
      sourceError,
      legacy,
      manySources,
      previewDelay,
      coverage,
      resumePosition,
      downloadFails,
      holdDownloadProgress,
      preparationMode,
    }) => {
      const report = {
        overallScore: 82,
        coreJudgment: "用选择与代价驱动故事，让每一次成长都改变人物关系。",
        summary:
          "故事围绕一次失踪展开。主角主动调查，在寻找答案的过程中逐渐理解规则，并为自己的选择承担后果。",
        oneLine: "调查是表层目标，人物关系的改变构成持续推进的动力。",
        dimensions: [
          { name: "人物塑造", score: 84 },
          { name: "情节结构", score: 81 },
        ],
        emotion: [
          { label: "开篇", value: 35 },
          { label: "转折", value: 68 },
          { label: "高潮", value: 92 },
        ],
        limitations: ["仅用于 UI 回归测试，不代表真实分析结果。"],
        ideasVersion: 2,
        ideas: ["起点", "起点", "番茄", "番茄"].map((platform, i) => ({
          platform,
          title: `测试方案 ${i + 1}`,
          genre: "都市悬疑",
          premise: "一个记录员发现城市每天都会丢失一段共同记忆。",
          sellingPoint: "记录越准确，现实中的证据就消失得越快。",
          difference: "改变主角的目标与解决问题的方式。",
          risk: "检查规则的代价是否真正影响主角选择。",
          audience: "喜欢规则推理与人物成长的读者。",
          opening: [1, 2, 3].map((chapter) => ({
            chapter: `第 ${chapter} 章`,
            event: "主角发现记录与现实不一致。",
            reward: "保住一份证据，同时失去同伴信任。",
            hook: "是谁改写了昨天？",
          })),
          storyEngine: "每解决一个事件，就必须重新判断一段重要关系。",
        })),
      };
      if (coverage) {
        (report as any).coverage = {
          pipelineVersion: 6,
          method: "逐段审读、原文引文核验、跨段综合",
          contentStatus: "complete",
          totalCharacters: 128000,
          processedCharacters: 128000,
          totalSegments: 2,
          processedSegments: 2,
          segments: [
            {
              segment: 1,
              characterStart: 1,
              characterEnd: 64000,
              summary: "主角拒绝了第一次交易。",
              evidence: [
                {
                  quote: "主角把信放回桌上",
                  finding: "主动拒绝",
                  characterStart: 132,
                },
              ],
            },
            {
              segment: 2,
              characterStart: 64001,
              characterEnd: 128000,
              summary: "后续选择改变了人物关系。",
              evidence: [
                {
                  quote: "同伴最终选择留下",
                  finding: "关系变化",
                  characterStart: 88760,
                },
              ],
            },
          ],
        };
      }
      if (legacy) {
        report.ideasVersion = 1;
        report.ideas = report.ideas
          .slice(0, 3)
          .map((idea) => ({ ...idea, platform: "" }));
      }
      let books = empty
        ? []
        : ["长夜行舟", "风起青萍", "一封没有寄出的信"].map((title, i) => ({
            id: `book-${i}`,
            title,
            sourceType: i === 0 ? "legado" : "file",
            contentStatus:
              i === 0
                ? preparationMode === "legacy-full"
                  ? "unknown"
                  : preparationMode || "complete"
                : "local",
            sourceUri: "UI 测试书源",
            characterCount: 128000 + i * 20000,
            createdAt: "2026-10-01T08:00:00Z",
            updatedAt: "2026-10-02T08:00:00Z",
            status: i === 0 ? "completed" : "ready",
            stage: i === 0 ? "分析完成" : "等待分析",
            completed: 12,
            total: 12,
            model: "deepseek-v4-flash",
            jobStartedAt: "",
            jobUpdatedAt: "",
            report: i === 0 && preparationMode !== "partial" ? report : null,
          }));
      const sources = Array.from(
        { length: manySources ? 420 : 24 },
        (_, i) => ({
          key: `source-${i}`,
          name:
            i === 0
              ? "一个名字很长的书源用于检查文本省略与对齐"
              : `测试书源 ${i + 1}`,
          group: "综合书库",
          url: "https://example.invalid",
          searchCompatible: true,
          importCompatible: true,
          reason: i % 2 ? "支持搜索、目录与正文" : "无需登录 · 支持全文",
          responseTime: 200,
        }),
      );
      const state = { calls: [] as { command: string; args: any }[] };
      const progressListeners = new Set<(event: any) => void>();
      const emitProgress = (payload: any) =>
        progressListeners.forEach((listener) => listener({ payload }));
      let progress =
        resumePosition === undefined
          ? null
          : {
              position: resumePosition,
              ratio: 0.35,
              updatedAt: "2026-10-02T08:00:00Z",
            };
      let recent: Array<{
        position: number;
        title: string;
        ratio: number;
        updatedAt: string;
      }> = progress ? [{ ...progress, title: "第二章 雨夜来客" }] : [];
      let clips: Array<{
        id: string;
        position: number;
        chapterTitle: string;
        quote: string;
        note: string;
        paragraph: number;
        createdAt: string;
        updatedAt: string;
      }> = [];
      (window as any).__UI_TEST__ = state;
      (window as any).__TAURI__ = {
        event: {
          listen: async (_name: string, listener: (event: any) => void) => {
            progressListeners.add(listener);
            return () => progressListeners.delete(listener);
          },
        },
        core: {
          invoke: async (command: string, args: any = {}) => {
            state.calls.push({ command, args });
            if (command === "list_books")
              return books.filter(
                (book) => !args.query || book.title.includes(args.query),
              );
            if (command === "get_book")
              return books.find((book) => book.id === args.id);
            if (
              command === "get_legado_source_status" ||
              command === "sync_legado_sources"
            )
              return {
                installed: true,
                repositoryUrl: "test",
                total: sources.length,
                searchable: sources.length,
                importable: sources.length,
                sources,
              };
            if (command === "search_legado_books") {
              await new Promise((resolve) => setTimeout(resolve, 300));
              if (sourceError) throw new Error("测试网络错误，请重试");
              return {
                results:
                  args.query === "无结果"
                    ? []
                    : [0, 1, 2].map((i) => ({
                        sourceKey: `source-${i}`,
                        sourceName: `测试书源 ${i + 1}`,
                        title: "长夜行舟",
                        author: "测试作者",
                        wordCount: i === 0 ? 1234567 : i === 1 ? 128000 : null,
                        intro: "在城市的旧档案里，寻找一段失落的记忆。",
                        coverUrl:
                          i === 0
                            ? "https://covers.example.test/valid.png"
                            : i === 1
                              ? "https://covers.example.test/missing.png"
                              : "",
                        bookUrl: "https://example.invalid/same-book",
                        importCompatible: true,
                      })),
                searchedSources: args.sourceKeys.length,
                failedSources: [],
              };
            }
            if (command === "get_reading_progress") return progress;
            if (command === "save_reading_progress") {
              progress = {
                position: args.position,
                ratio: args.ratio,
                updatedAt: "2026-10-02T08:00:00Z",
              };
              const titles = [
                "第一章 旧城来信",
                "第二章 雨夜来客",
                "第三章 无人站台",
              ];
              recent = [
                { ...progress, title: titles[args.position] },
                ...recent.filter((item) => item.position !== args.position),
              ];
              return;
            }
            if (command === "list_reading_history") return recent;
            if (command === "list_reading_clips") return clips;
            if (command === "save_reading_clip") {
              const clip = {
                id: `clip-${clips.length + 1}`,
                position: args.input.position,
                chapterTitle: [
                  "第一章 旧城来信",
                  "第二章 雨夜来客",
                  "第三章 无人站台",
                ][args.input.position],
                quote: args.input.quote,
                note: args.input.note,
                paragraph: args.input.paragraph,
                createdAt: "2026-10-02T08:00:00Z",
                updatedAt: "2026-10-02T08:00:00Z",
              };
              clips = [clip, ...clips];
              return clip;
            }
            if (command === "update_reading_clip") {
              clips = clips.map((item) =>
                item.id === args.clipId ? { ...item, note: args.note } : item,
              );
              return;
            }
            if (command === "delete_reading_clip") {
              clips = clips.filter((item) => item.id !== args.clipId);
              return;
            }
            if (command === "list_chapters")
              return [0, 1, 2].map((position) => ({
                position,
                title: [
                  "第一章 旧城来信",
                  "第二章 雨夜来客",
                  "第三章 无人站台",
                ][position],
                characterCount: 2100,
              }));
            if (command === "get_chapter")
              return {
                position: args.position,
                title: [
                  "第一章 旧城来信",
                  "第二章 雨夜来客",
                  "第三章 无人站台",
                ][args.position],
                characterCount: 2100,
                content:
                  "这是用于检查阅读排版的测试正文。\n雨停的时候，街灯刚刚亮起。他把那封信放进口袋，沿着旧街慢慢走去。\n".repeat(
                    8,
                  ),
              };
            if (command === "preview_legado_toc") {
              if (previewDelay)
                await new Promise((resolve) => setTimeout(resolve, 600));
              return [
                {
                  position: 0,
                  title: "第一章 旧城来信",
                  chapterUrl: "https://example.invalid/chapter",
                },
              ];
            }
            if (command === "preview_legado_chapter")
              return {
                title: "第一章 旧城来信",
                content: "章节预览测试正文。",
                characterCount: 12,
              };
            if (command === "extract_legado_book") {
              for (let completed = 0; completed <= 3; completed++) {
                emitProgress({
                  progressId: args.request.progressId,
                  completed,
                  total: 3,
                  failed: downloadFails && completed === 3 ? 1 : 0,
                  phase: completed === 3 ? "finished" : "downloading",
                });
                if (holdDownloadProgress && completed === 1) {
                  await new Promise<void>((resolve) => {
                    (window as any).__UI_TEST__.releaseDownloadProgress =
                      resolve;
                  });
                }
                await new Promise((resolve) => setTimeout(resolve, 90));
              }
              return {
                title: args.request.title,
                content: "预览导入测试正文。".repeat(20),
                sourceName: "测试书源 2",
                sourceUri: args.request.bookUrl,
                chapterCount: downloadFails ? 2 : 3,
                failedChapters: downloadFails ? 1 : 0,
                receipt: {
                  sourceKey: args.request.sourceKey,
                  bookUrl: args.request.bookUrl,
                  totalChapters: 3,
                  downloadedChapters: downloadFails ? 2 : 3,
                  failedChapters: downloadFails ? 1 : 0,
                  checkedAt: "2026-10-02",
                },
              };
            }
            if (command === "delete_book") {
              books = books.filter((book) => book.id !== args.id);
              return;
            }
            if (command === "create_book") {
              const book = {
                id: "new-book",
                ...args.input,
                characterCount: args.input.content.length,
                status: "ready",
                stage: "等待分析",
                completed: 0,
                total: 0,
                model: "",
                report: null,
                createdAt: "2026-10-02",
                updatedAt: "2026-10-02",
                jobStartedAt: "",
                jobUpdatedAt: "",
              };
              books.push(book);
              return book;
            }
            if (command === "prepare_analysis") {
              const book = books.find((item) => item.id === args.id);
              if (preparationMode === "legacy-full")
                book.contentStatus = "complete";
              return {
                book,
                canDownload: book.sourceType === "legado",
                message:
                  book.contentStatus === "complete"
                    ? "已核对书源全部章节，无需补全。"
                    : "缺少部分正文，建议下载完整正文。",
              };
            }
            if (command === "refresh_legado_book") {
              for (let completed = 0; completed <= 3; completed++) {
                emitProgress({
                  progressId: args.progressId,
                  completed,
                  total: 3,
                  failed: 0,
                  phase: completed === 3 ? "finished" : "downloading",
                });
                await new Promise((resolve) => setTimeout(resolve, 70));
              }
              const book = books.find((item) => item.id === args.id);
              book.contentStatus = "complete";
              book.report = null;
              book.status = "ready";
              book.characterCount = 180000;
              book.downloadReceipt = {
                sourceKey: "source-0",
                bookUrl: "https://example.invalid/book",
                totalChapters: 50,
                downloadedChapters: 50,
                failedChapters: 0,
                checkedAt: "2026-10-02",
              };
              return { ...book };
            }
            if (command === "start_analysis") {
              const book = books.find((item) => item.id === args.id);
              book.status = "analyzing";
              book.stage = "准备原文切片";
              return;
            }
            if (command === "export_book") return "/tmp/ui-test.txt";
            if (command === "test_model") return true;
            throw new Error(`Unexpected test command: ${command}`);
          },
        },
      };
    },
    options,
  );
  await page.route("https://covers.example.test/**", async (route) => {
    if (route.request().url().endsWith("missing.png"))
      return route.fulfill({ status: 404, body: "missing" });
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="110"><rect width="80" height="110" fill="#dde5e2"/><path d="M10 75L35 25L65 90" fill="none" stroke="#667e73" stroke-width="6"/></svg>',
    });
  });
}

test("bookshelf, keyboard dialogs and deletion retain the correct book", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的书架" })).toBeVisible();
  await expect(page.locator('[data-slot="card"]')).toHaveCount(3);
  await expect(page.locator('[data-slot="card"]').first()).toContainText(
    "12.8 万字",
  );
  await expect(page.locator('[data-slot="card"]').first()).not.toContainText(
    "字符",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/bookshelf.png" });
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索书库内容" }).fill("风起");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-slot="card"]')).toHaveCount(3);
  await page.getByRole("button", { name: "删除风起青萍" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeFocused();
  await page.getByRole("button", { name: "删除书籍", exact: true }).click();
  await expect(page.locator('[data-slot="card"]')).toHaveCount(2);
});

test("source search selection, loading, empty state, preview and narrow window", async ({
  page,
}) => {
  await mockDesktop(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: "添加书籍" })
    .click();
  await page.getByRole("button", { name: "书源范围 · 24" }).click();
  await expect(page.getByText("24 / 60 已选", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await expect(page.getByText("0 / 60 已选", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "完成选择" }).click();
  await expect(
    page.getByRole("button", { name: "搜索", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "书源范围 · 0" }).click();
  await page
    .getByRole("checkbox", { name: "测试书源 2", exact: false })
    .first()
    .check();
  await page.getByRole("button", { name: "完成选择" }).click();
  await page.getByRole("textbox", { name: "搜索小说" }).fill("长夜行舟");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("正在搜索 1 个书源")).toBeVisible();
  await expect(page.locator(".source-book-row")).toHaveCount(3);
  await expect(page.locator(".source-book-row").first()).toContainText(
    "书源约 123.46 万字",
  );
  await expect(page.locator(".source-book-row").nth(1)).toContainText(
    "书源约 12.8 万字",
  );
  await expect(page.locator(".source-book-row").nth(2)).toContainText(
    "字数未知",
  );
  await page.locator(".source-book-row").nth(1).click();
  await expect(page.locator(".book-preview-header")).toContainText(
    "书源约 12.8 万字",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".book-preview-header")).toContainText(
    "测试书源 2",
  );
  await expect(
    page.getByRole("button", { name: "加入书架", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("加入时下载目录全部章节")).toBeVisible();
  await page.getByRole("button", { name: "预览目录" }).click();
  await page.locator(".book-preview-toc nav button").first().click();
  await expect(page.getByText("章节预览测试正文。")).toBeVisible();
  await page.screenshot({ path: "test-results/book-preview.png" });
  await page.setViewportSize({ width: 980, height: 680 });
  await expect
    .poll(() =>
      page.getByRole("dialog").evaluate((element) => {
        const r = element.getBoundingClientRect();
        return {
          inside:
            r.x >= 0 &&
            r.y >= 0 &&
            r.right <= innerWidth &&
            r.bottom <= innerHeight,
          width: r.width,
          height: r.height,
        };
      }),
    )
    .toMatchObject({ inside: true });
  await page.screenshot({ path: "test-results/book-preview-980.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "加入书架", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: "test-results/book-preview-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.locator(".source-book-row").nth(1)).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/source-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 980, height: 680 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/source-980.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/source-mobile.png",
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "搜索小说" }).fill("无结果");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("没有找到匹配的作品")).toBeVisible();
  expect(errors).toEqual([]);
});

test("paste import validates consent and sends the original create_book contract", async ({
  page,
}) => {
  await mockDesktop(page, { empty: true });
  await page.goto("/");
  await page.getByRole("button", { name: "添加第一本书" }).click();
  await page.getByRole("tab", { name: "粘贴正文" }).click();
  await page.getByLabel("作品名", { exact: true }).fill("新书测试");
  const content =
    "第一章 测试正文\n" + "这是合法导入验证所使用的测试内容。".repeat(10);
  await page.getByLabel("小说正文", { exact: true }).fill(content);
  await expect(
    page.getByRole("button", { name: "加入书架", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "我确认对该内容拥有合法阅读和私人分析权限。",
    })
    .check();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/import-text.png" });
  await page.getByRole("button", { name: "加入书架", exact: true }).click();
  await expect(page.locator(".reader-header h1")).toHaveText("新书测试");
  const input = await page.evaluate(
    () =>
      (window as any).__UI_TEST__.calls.find(
        (call: any) => call.command === "create_book",
      ).args.input,
  );
  expect(input).toEqual({
    title: "新书测试",
    sourceType: "text",
    sourceUri: "",
    content,
  });
});

test("reader, export and report tabs retain v2 content", async ({ page }) => {
  await mockDesktop(page, { coverage: true });
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await expect(page.locator(".chapter-heading h2")).toHaveText(
    "第一章 旧城来信",
  );
  await page.getByRole("button", { name: "下一章" }).click();
  await expect(page.locator(".chapter-heading h2")).toHaveText(
    "第二章 雨夜来客",
  );
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "导出 TXT" }).click();
  await expect(page.getByText("已导出到 /tmp/ui-test.txt")).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/reader.png" });
  await page.getByRole("button", { name: "分析报告", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "总览", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/report.png" });
  await page.getByRole("tab", { name: "原创灵感 4" }).click();
  await expect(page.locator(".idea-proposal")).toHaveCount(4);
  await page.getByRole("radio", { name: "番茄 · 2" }).click();
  await expect(page.locator(".idea-proposal")).toHaveCount(2);
  await page.locator(".idea-proposal summary").first().click();
  await expect(
    page.getByText("每解决一个事件，就必须重新判断一段重要关系。").first(),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/ideas.png", fullPage: true });
});

test("settings use keyboard accessible shadcn Select and source failures are visible", async ({
  page,
}) => {
  await mockDesktop(page, { sourceError: true });
  await page.goto("/");
  await page.getByRole("button", { name: "模型与设置" }).click();
  await page.getByLabel("API Key", { exact: true }).fill("test-only-key");
  await page.getByRole("combobox", { name: "模型", exact: true }).click();
  await page.getByRole("option", { name: "DeepSeek V4 Pro" }).click();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("连接成功，可以开始分析与创作。")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/settings.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "模型与设置" })).toBeFocused();
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: "添加书籍" })
    .click();
  await page.getByRole("textbox", { name: "搜索小说" }).fill("出错");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("测试网络错误，请重试");
});

test("legacy ideas remain readable without the v2 platform filter", async ({
  page,
}) => {
  await mockDesktop(page, { legacy: true });
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "报告", exact: true })
    .click();
  await page.getByRole("tab", { name: "原创灵感 3" }).click();
  await expect(page.locator(".idea-proposal")).toHaveCount(3);
  await expect(
    page.getByText("这是旧版灵感。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "灵感平台筛选" })).toHaveCount(
    0,
  );
});

test("file import keeps the filename and validates supported formats", async ({
  page,
}) => {
  await mockDesktop(page, { empty: true });
  await page.goto("/");
  await page.getByRole("button", { name: "添加第一本书" }).click();
  await page.getByRole("tab", { name: "本地文件" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "unsupported.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("test"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "请选择 TXT 或 Markdown 文件",
  );
  const content =
    "第一章 测试文件\n" + "用于验证本地文件导入与文件名保留。".repeat(10);
  await page.locator('input[type="file"]').setInputFiles({
    name: "本地测试.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(content),
  });
  await expect(page.getByLabel("作品名", { exact: true })).toHaveValue(
    "本地测试",
  );
  await page
    .getByRole("checkbox", {
      name: "我确认对该内容拥有合法阅读和私人分析权限。",
    })
    .check();
  await page.getByRole("button", { name: "加入书架", exact: true }).click();
  await expect(page.locator(".reader-header h1")).toHaveText("本地测试");
  const input = await page.evaluate(
    () =>
      (window as any).__UI_TEST__.calls.find(
        (call: any) => call.command === "create_book",
      ).args.input,
  );
  expect(input).toEqual({
    title: "本地测试",
    sourceType: "file",
    sourceUri: "本地测试.md",
    content,
  });
});

test("all sources remain accessible with pagination and the 60-source limit", async ({
  page,
}) => {
  await mockDesktop(page, { manySources: true });
  await page.goto("/");
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: "添加书籍" })
    .click();
  await page.getByRole("button", { name: "书源范围 · 30" }).click();
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByRole("button", { name: "下一页书源" }).click();
  await expect(page.getByText("第 2 / 9 页")).toBeVisible();
  await page.getByRole("button", { name: "补选本页" }).click();
  await expect(page.getByText("50 / 60 已选", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "下一页书源" }).click();
  await page.getByRole("button", { name: "补选本页" }).click();
  await expect(page.getByText("60 / 60 已选", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "测试书源 111", exact: false }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByRole("textbox", { name: "筛选书源" }).fill("测试书源 420");
  await page
    .getByRole("checkbox", { name: "测试书源 420", exact: false })
    .check();
  await page.getByRole("textbox", { name: "筛选书源" }).fill("");
  await page.screenshot({ path: "test-results/source-manager.png" });
  await page.getByRole("button", { name: "完成选择" }).click();
  await page.getByRole("textbox", { name: "搜索小说" }).fill("长夜行舟");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".source-book-row")).toHaveCount(3);
  const args = await page.evaluate(
    () =>
      (window as any).__UI_TEST__.calls.find(
        (call: any) => call.command === "search_legado_books",
      ).args,
  );
  expect(args.sourceKeys).toEqual(["source-419"]);
});

test("author mode, valid and broken covers, and scoped import use the selected source", async ({
  page,
}) => {
  await mockDesktop(page, { holdDownloadProgress: true });
  await page.goto("/");
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: "添加书籍" })
    .click();
  await page.getByRole("combobox", { name: "搜索方式" }).click();
  await page.getByRole("option", { name: "作者", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索小说" }).fill("测试作者");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".source-book-row")).toHaveCount(3);
  await expect(
    page.locator(".source-book-row").first().locator("img"),
  ).toBeVisible();
  expect(
    await page
      .locator(".source-book-row")
      .first()
      .locator("img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await expect(
    page.locator(".source-book-row").nth(1).locator("img"),
  ).toHaveCount(0);
  await page.locator(".source-book-row").nth(1).click();
  await expect(page.getByText("加入时下载目录全部章节")).toBeVisible();
  await page
    .getByRole("checkbox", { name: "我拥有合法阅读与私人分析权限" })
    .check();
  await page.getByRole("button", { name: "加入书架", exact: true }).click();
  await expect(page.getByText(/1 \/ 3 章/)).toBeVisible();
  await page.evaluate(() =>
    (window as any).__UI_TEST__.releaseDownloadProgress(),
  );
  await expect(page.locator(".reader-header h1")).toHaveText("长夜行舟");
  const calls = await page.evaluate(() => (window as any).__UI_TEST__.calls);
  expect(
    calls.find((c: any) => c.command === "search_legado_books").args.mode,
  ).toBe("author");
  expect(
    calls.find((c: any) => c.command === "extract_legado_book").args.request,
  ).toEqual(
    expect.objectContaining({
      sourceKey: "source-1",
      bookUrl: "https://example.invalid/same-book",
      title: "长夜行舟",
      maxChapters: 0,
      progressId: expect.any(String),
    }),
  );
});

test("failed full-book download does not add an incomplete book", async ({
  page,
}) => {
  await mockDesktop(page, { downloadFails: true, holdDownloadProgress: true });
  await page.goto("/");
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: "添加书籍" })
    .click();
  await page.getByRole("textbox", { name: "搜索小说" }).fill("长夜行舟");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".source-book-row").first().click();
  await page
    .getByRole("checkbox", { name: "我拥有合法阅读与私人分析权限" })
    .check();
  await page.getByRole("button", { name: "加入书架", exact: true }).click();
  await expect(page.getByText(/1 \/ 3 章/)).toBeVisible();
  await page.evaluate(() =>
    (window as any).__UI_TEST__.releaseDownloadProgress(),
  );
  await expect(page.getByText(/1 章下载失败，书籍未加入书架/)).toBeVisible();
  const commands = await page.evaluate(() =>
    (window as any).__UI_TEST__.calls.map((call: any) => call.command),
  );
  expect(commands).not.toContain("create_book");
});

test("closing a loading preview does not leak results into another book", async ({
  page,
}) => {
  await mockDesktop(page, { previewDelay: true });
  await page.goto("/");
  await page
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasText: "添加书籍" })
    .click();
  await page.getByRole("textbox", { name: "搜索小说" }).fill("长夜行舟");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.locator(".source-book-row").first().click();
  await page.getByRole("button", { name: "预览目录", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".source-book-row").nth(1).click();
  await expect(page.locator(".book-preview-header")).toContainText(
    "测试书源 2",
  );
  await expect(page.getByText("预览后再决定是否导入")).toBeVisible();
  await page.getByRole("button", { name: "预览目录", exact: true }).click();
  await page.locator(".book-preview-toc nav button").first().click();
  await expect(page.getByText("章节预览测试正文。")).toBeVisible();
});

test("word counts preserve punctuation, whitespace and Unicode while formatting ten-thousands", () => {
  expect(countText("甲，乙。!? 😀\n")).toBe(9);
  expect(formatWordCount(null)).toBe("字数未知");
  expect(formatWordCount(0)).toBe("0 万字");
  expect(formatWordCount(80)).toBe("不足 0.01 万字");
  expect(formatWordCount(2100)).toBe("0.21 万字");
  expect(formatWordCount(128000)).toBe("12.8 万字");
  expect(formatWordCount(1234567)).toBe("123.46 万字");
});

test("paste import count agrees with Rust Unicode and includes punctuation", async ({
  page,
}) => {
  await mockDesktop(page, { empty: true });
  await page.goto("/");
  await page.getByRole("button", { name: "添加第一本书" }).click();
  await page.getByRole("tab", { name: "粘贴正文" }).click();
  await page.getByLabel("作品名", { exact: true }).fill("字数验证");
  await page
    .getByRole("checkbox", {
      name: "我确认对该内容拥有合法阅读和私人分析权限。",
    })
    .check();
  await page
    .getByLabel("小说正文", { exact: true })
    .fill("字".repeat(74) + "，。!?😀");
  await expect(
    page.getByRole("button", { name: "加入书架", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("小说正文", { exact: true })
    .fill("字".repeat(75) + "，。!?😀");
  await expect(
    page.getByRole("button", { name: "加入书架", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("不足 0.01 万字 · 含标点，至少需要 80 字"),
  ).toBeVisible();
});

test("partial source downloads and saves before analysis, complete source hides refill", async ({
  page,
}) => {
  await mockDesktop(page, { preparationMode: "partial" });
  await page.addInitScript(() =>
    localStorage.setItem(
      "inkscope-model",
      JSON.stringify({
        apiKey: "ui-only-key",
        model: "deepseek-v4-flash",
        baseUrl: "https://example.invalid",
      }),
    ),
  );
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "分析", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "准备分析《长夜行舟》" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载完整正文并分析" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/analysis-preparation.png" });
  await page.getByRole("button", { name: "下载完整正文并分析" }).click();
  await expect(page.getByText("准备原文切片")).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).__UI_TEST__.calls.map((call: any) => ({
      command: call.command,
      args: call.args,
    })),
  );
  const commands = calls.map((call: any) => call.command);
  expect(commands.indexOf("prepare_analysis")).toBeLessThan(
    commands.indexOf("refresh_legado_book"),
  );
  expect(commands.indexOf("refresh_legado_book")).toBeLessThan(
    commands.indexOf("start_analysis"),
  );
  expect(
    calls.find((call: any) => call.command === "start_analysis").args
      .allowPartial,
  ).toBe(false);
});

test("verified complete book starts directly and never shows refill", async ({
  page,
}) => {
  await mockDesktop(page, { preparationMode: "complete" });
  await page.addInitScript(() =>
    localStorage.setItem(
      "inkscope-model",
      JSON.stringify({
        apiKey: "ui-only-key",
        model: "deepseek-v4-flash",
        baseUrl: "https://example.invalid",
      }),
    ),
  );
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "补全全书" })).toHaveCount(0);
  await page.getByRole("button", { name: "分析报告", exact: true }).click();
  await page.getByRole("button", { name: "重新分析" }).click();
  await expect(
    page.getByRole("dialog", { name: "准备分析《长夜行舟》" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载完整正文并分析" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "开始通读分析" }).click();
  const calls = await page.evaluate(() =>
    (window as any).__UI_TEST__.calls.map((call: any) => call.command),
  );
  expect(calls).toContain("start_analysis");
  expect(calls).not.toContain("refresh_legado_book");
});

test("reading legacy source does not trigger network completeness checks", async ({
  page,
}) => {
  await mockDesktop(page, { preparationMode: "legacy-full" });
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "补全全书" })).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).__UI_TEST__.calls.map((call: any) => call.command),
  );
  expect(calls).not.toContain("prepare_analysis");
  expect(calls).not.toContain("refresh_legado_book");
});

test("new report exposes verified coverage while old reports are labeled", async ({
  page,
}) => {
  await mockDesktop(page, { coverage: true });
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "报告", exact: true })
    .click();
  await expect(page.getByText("正文审读记录 · 2 / 2 段")).toBeVisible();
  await page
    .locator(".report-page details")
    .first()
    .locator("summary")
    .first()
    .click();
  await page.getByText("片段 1 · 第 1—64,000 字").click();
  await expect(page.getByText("主角把信放回桌上")).toBeVisible();
  await page.screenshot({ path: "test-results/reading-coverage.png" });
});

test("reader resumes a chapter, keeps exact word counts and offers a clean reading mode", async ({
  page,
}) => {
  await mockDesktop(page, { resumePosition: 1 });
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await expect(page.locator(".chapter-heading h2")).toHaveText(
    "第二章 雨夜来客",
  );
  await expect(page.locator(".chapter-heading")).toContainText("2,100 字");
  await expect(page.locator(".chapter-prose p")).toHaveCount(16);
  await expect(page.locator(".chapter-prose br")).toHaveCount(0);
  await page.getByRole("tab", { name: "记录" }).click();
  await expect(
    page.getByRole("button", { name: /第二章 雨夜来客.*35%/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "阅读设置" }).click();
  await page.getByRole("button", { name: /纸张.*温暖柔和/ }).click();
  await page.getByRole("button", { name: "放大字号" }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-theme",
    "paper",
  );
  await page.getByRole("button", { name: "阅读设置" }).click();
  await page.getByRole("button", { name: /护眼.*柔和浅绿/ }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-theme",
    "sage",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("inkscope-reader-v1") || "{}").fontSize,
    ),
  ).toBe(18);
  await page.getByRole("button", { name: "阅读模式" }).click();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".reader-header")).toHaveCount(0);
  await expect(page.locator(".chapter-sidebar")).toHaveCount(0);
  await expect(page.locator(".chapter-prose p").first()).toBeVisible();
  await page.locator(".reader-content").evaluate((element) => {
    element.style.scrollBehavior = "auto";
    element.scrollTop = 0;
  });
  await expect
    .poll(() =>
      page.locator(".reader-content").evaluate((element) => element.scrollTop),
    )
    .toBe(0);
  await page.screenshot({ path: "test-results/reader-focus.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".topbar")).toBeVisible();
  await page.setViewportSize({ width: 980, height: 680 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/reader-980.png" });
});

test("phone reading preserves text position, offers navigation and survives reopening", async ({
  page,
}) => {
  await mockDesktop(page, { resumePosition: 1 });
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await expect(page.locator(".chapter-heading h2")).toHaveText(
    "第二章 雨夜来客",
  );
  await page.waitForTimeout(350);
  const originalParagraph = await page
    .locator(".reader-content")
    .evaluate((element) => {
      element.style.scrollBehavior = "auto";
      element.scrollTop = 500;
      const top = element.getBoundingClientRect().top;
      return Array.from(
        element.querySelectorAll<HTMLElement>("[data-paragraph]"),
      ).find((item) => item.getBoundingClientRect().bottom > top)!.dataset
        .paragraph;
    });
  await page.getByRole("button", { name: "手机模式", exact: true }).click();
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-layout",
    "phone",
  );
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".reader-header")).toHaveCount(0);
  await expect(page.locator(".chapter-sidebar")).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator(".reader-content").evaluate((element) => {
        const top = element.getBoundingClientRect().top;
        return Array.from(
          element.querySelectorAll<HTMLElement>("[data-paragraph]"),
        ).find((item) => item.getBoundingClientRect().bottom > top)?.dataset
          .paragraph;
      }),
    )
    .toBe(originalParagraph);
  const frame = await page.locator(".reader-shell").boundingBox();
  expect(frame!.width).toBeLessThanOrEqual(390);
  expect(frame!.height / frame!.width).toBeGreaterThan(1.7);
  await page.locator(".reader-content").evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator(".chapter-heading")).toContainText("本章已读 0%");
  await page.screenshot({ path: "test-results/reader-phone.png" });
  await page.getByRole("button", { name: "目录", exact: true }).click();
  const navigation = page.getByRole("dialog", { name: "阅读导航" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("tab", { name: "记录" }).click();
  await expect(
    navigation.getByRole("button", { name: /第二章 雨夜来客/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveCount(0);
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-layout",
    "phone",
  );
  await page.getByRole("button", { name: "下一章", exact: true }).click();
  await expect(page.locator(".chapter-heading h2")).toHaveText(
    "第三章 无人站台",
  );
  await expect(
    page.getByRole("button", { name: "下一章", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "阅读设置", exact: true }).click();
  await page.getByRole("button", { name: /护眼.*柔和浅绿/ }).click();
  await page.getByRole("button", { name: "放大字号" }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-theme",
    "sage",
  );
  await page.setViewportSize({ width: 980, height: 680 });
  const smallFrame = await page.locator(".reader-shell").boundingBox();
  expect(smallFrame!.y + smallFrame!.height).toBeLessThanOrEqual(680);
  const smallContent = await page.locator(".reader-content").boundingBox();
  expect(smallContent!.width).toBeGreaterThan(smallFrame!.width - 20);
  expect(
    await page
      .locator(".reader-content")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/reader-phone-980.png" });
  await page.reload();
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-layout",
    "phone",
  );
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-theme",
    "sage",
  );
  await page.getByRole("button", { name: "退出手机模式" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-layout",
    "desktop",
  );
  await page.getByRole("button", { name: "手机模式", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".reader-page")).toHaveAttribute(
    "data-reader-layout",
    "desktop",
  );
});

test("reader speech can start, pause, resume and stop without leaving a highlight", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as any).__speechCalls = calls;
    (window as any).SpeechSynthesisUtterance = class {
      text: string;
      lang = "";
      rate = 1;
      voice = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        speak: (utterance: { text: string }) =>
          calls.push(`speak:${utterance.text}`),
        pause: () => calls.push("pause"),
        resume: () => calls.push("resume"),
        cancel: () => calls.push("cancel"),
      },
    });
  });
  await mockDesktop(page);
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await page.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "朗读" })).toBeVisible();
  await page.getByRole("button", { name: "开始朗读" }).click();
  await expect(page.locator(".reader-speaking")).toHaveCount(1);
  await page.getByRole("button", { name: "暂停朗读" }).click();
  await page.getByRole("button", { name: "继续朗读" }).click();
  await page.getByRole("button", { name: "停止朗读" }).click();
  await expect(page.locator(".reader-speaking")).toHaveCount(0);
  const calls = await page.evaluate(
    () => (window as any).__speechCalls as string[],
  );
  expect(calls.some((call) => call.startsWith("speak:"))).toBe(true);
  expect(calls).toContain("pause");
  expect(calls).toContain("resume");
  expect(calls.at(-1)).toBe("cancel");
});

test("online reading offers built-in voices without asking for an address", async ({
  page,
}) => {
  expect(builtInSpeechEngines.length).toBeGreaterThanOrEqual(10);
  expect(speechTemplateForVoice("aningfp")).toContain("voiceId=aningfp");
  expect(speechTemplateForVoice("unknown")).toBeNull();
  await mockDesktop(page);
  await page.goto("/");
  await page
    .locator('[data-slot="card"]')
    .first()
    .getByRole("button", { name: "阅读", exact: true })
    .click();
  await page.getByRole("button", { name: "朗读", exact: true }).click();
  await page.getByRole("combobox", { name: "朗读方式" }).click();
  await page.getByRole("option", { name: "在线朗读 · 内置声音" }).click();
  await expect(page.getByRole("combobox", { name: "在线声音" })).toBeVisible();
  await expect(page.getByLabel("自定义引擎地址")).toHaveCount(0);
  await page.getByRole("combobox", { name: "在线声音" }).click();
  await page.getByRole("option", { name: "安宁 · 柔和女声" }).click();
  await page.screenshot({ path: "test-results/reader-speech.png" });
  await page.getByRole("button", { name: "开始朗读" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__UI_TEST__.calls.find(
            (call: any) => call.command === "fetch_speech_audio",
          )?.args.template,
      ),
    )
    .toContain("voiceId=aningfp");
});

for (const phoneMode of [false, true]) {
  test(`selected text becomes a persistent inspiration clip with editable notes${phoneMode ? " in phone mode" : ""}`, async ({
    page,
  }) => {
    await mockDesktop(page);
    await page.goto("/");
    await page
      .locator('[data-slot="card"]')
      .first()
      .getByRole("button", { name: "阅读", exact: true })
      .click();
    await expect(page.locator(".chapter-prose p").first()).toBeVisible();
    if (phoneMode)
      await page.getByRole("button", { name: "手机模式", exact: true }).click();
    await page.evaluate(() => {
      const paragraphs = document.querySelectorAll(".chapter-prose p");
      const range = document.createRange();
      range.setStart(paragraphs[0].firstChild!, 2);
      range.setEnd(paragraphs[1].firstChild!, 12);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      paragraphs[1].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(page.getByRole("button", { name: "收藏片段" })).toBeVisible();
    await page.getByRole("button", { name: "收藏片段" }).click();
    await expect(page.getByRole("dialog", { name: "收藏片段" })).toBeVisible();
    await page.getByLabel("备注（可选）").fill("借鉴这里的短句节奏。");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "收藏片段" })
      .click();
    if (phoneMode) {
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "目录", exact: true }).click();
    }
    await page.getByRole("tab", { name: "灵感集 1" }).click();
    await expect(page.getByText("借鉴这里的短句节奏。")).toBeVisible();
    await page.getByRole("button", { name: "编辑备注" }).click();
    await page.getByLabel("备注（可选）").fill("人物反应也值得记录。");
    await page.getByRole("button", { name: "保存备注" }).click();
    await expect(page.locator(".reader-clip-main em")).toHaveText(
      "人物反应也值得记录。",
    );
    await expect(page.getByRole("dialog")).toHaveCount(phoneMode ? 1 : 0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    const saved = await page.evaluate(() =>
      (window as any).__UI_TEST__.calls.find(
        (call: any) => call.command === "save_reading_clip",
      ),
    );
    expect(saved.args.input.quote.length).toBeGreaterThan(0);
    expect(saved.args.input.note).toBe("借鉴这里的短句节奏。");
    await page.locator(".reader-clip-main").click();
    if (phoneMode) await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".reader-active-clip")).toHaveCount(2);
    const highlighted = await page
      .locator(".reader-active-clip")
      .allTextContents();
    expect(highlighted.join("").replace(/\s/g, "")).toBe(
      saved.args.input.quote.replace(/\s/g, ""),
    );
    await page.screenshot({
      path: `test-results/${phoneMode ? "reader-phone-clips" : "reader-clips"}.png`,
    });
    if (phoneMode) {
      await page
        .getByRole("button", { name: "退出片段定位", exact: true })
        .click();
      await page.getByRole("button", { name: "目录", exact: true }).click();
    } else await page.getByRole("tab", { name: "目录" }).click();
    await expect(page.locator(".reader-active-clip")).toHaveCount(0);
    await page.getByRole("tab", { name: "灵感集 1" }).click();
    await page.getByRole("button", { name: /删除收藏：/ }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "删除收藏" })
      .click();
    await expect(
      page.getByText("在正文中划选一段文字，即可收藏并添加备注。"),
    ).toBeVisible();
  });
}

test("report idea can seed a new original creation project", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.evaluate(() => {
    const original = window.__TAURI__!.core.invoke;
    window.__TAURI__!.core.invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "list_creations") return [] as T;
      return original<T>(command, args);
    };
  });
  await page
    .getByRole("button", { name: "报告", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: /原创灵感/ }).click();
  await page
    .getByRole("button", { name: "以此创建作品", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("作品名称", { exact: true })).toHaveValue(
    "测试方案 1",
  );
  await expect(dialog.getByLabel("故事灵感")).toHaveValue(/记录越准确/);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "创作空间", exact: true }),
  ).toBeVisible();
});
