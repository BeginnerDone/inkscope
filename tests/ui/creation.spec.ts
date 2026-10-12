import { expect, test, type Page } from "@playwright/test";

async function creationDesktop(
  page: Page,
  options: {
    delaySave?: boolean;
    failedTask?: boolean;
    recovered?: boolean;
    deleteBlocked?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    const stamp = "2026-10-08T08:00:00Z";
    const docs = [
      "brief",
      "rules",
      "characters",
      "outline",
      "facts",
      "style",
      "chapter",
      "chapter",
      "chapter",
    ].map((kind, i) => ({
      id: `doc-${i}`,
      kind,
      title: [
        "作品策划",
        "世界与规则",
        "人物与关系",
        "全书与分卷大纲",
        "正文事实与伏笔",
        "文风与写作约定",
        "第1章",
        "第2章",
        "第3章",
      ][i],
      content:
        i === 0
          ? "一个记录员发现城市正在丢失记忆。"
          : i === 6
            ? "这是作者的旧正文。"
            : "",
      goal: "",
      volumeId: kind === "chapter" ? "v1" : "",
    }));
    let project: any = {
      id: "project-1",
      title: "长夜记录员",
      genre: "都市悬疑",
      audience: "喜欢规则推理的读者",
      revision: 0,
      createdAt: stamp,
      updatedAt: stamp,
      documents: docs,
      volumes: [{ id: "v1", title: "第一卷" }],
      guidance: {},
    };
    let tasks: any[] = [];
    const cycles: Record<string, any> = {};
    const cycle = (id: string) => cycles[id] ||= { review: null, activeFinalization: null, finalizations: [], recordTaskIds: [] };
    let deleted = false;
    let versions: any[] = docs.map((d) => ({
      ...d,
      id: `initial-${d.id}`,
      documentId: d.id,
      reason: "初始版本",
      createdAt: stamp,
    }));
    const calls: any[] = [];
    const skills = [
      "premise",
      "opening",
      "outline",
      "draft",
      "review",
      "polish",
      "memory",
    ].map((id, i) => ({
      id,
      title: [
        "选题与卖点",
        "开篇与场景设计",
        "分卷与长线布局",
        "章节起草与续写",
        "章节诊断",
        "语言润色",
        "事实与伏笔整理",
      ][i],
      description: "按照作者已确认的资料工作",
      instructions: "保留已有正文与设定，候选先确认，再进入正式记录。",
      version: 1,
    }));
    localStorage.setItem(
      "inkscope-model",
      JSON.stringify({
        apiKey: "fixture-not-real-key",
        model: "test-model",
        baseUrl: "https://example.invalid",
      }),
    );
    if (options.recovered)
      localStorage.setItem(
        "inkscope-creation-draft-project-1",
        JSON.stringify({
          ...project,
          documents: project.documents.map((d: any) =>
            d.id === "doc-6" ? { ...d, content: "上次尚未保存的段落。" } : d,
          ),
        }),
      );
    (window as any).__CREATION_TEST__ = {
      calls,
      get project() {
        return project;
      },
      get tasks() {
        return tasks;
      },
    };
    const copy = (value: any) => JSON.parse(JSON.stringify(value));
    (window as any).__TAURI__ = {
      core: {
        invoke: async (command: string, args: any = {}) => {
            const store = ((window as any).__SQLITE_TEST__ ||= {});
            if(command === "writer_assist") {
              (window as any).__WRITER_CALLS__ ||= []; (window as any).__WRITER_CALLS__.push(args);
              if(args.action === "names")return {names:["林清川","林知远","林怀瑾","林景行","林砚舟","林望舒","林修竹","林云深","林时安","林星野"]};
              if(args.action === "complete")return {text:"他终于推开了门。"};
              if(args.action === "correct")return {corrections:[]};
              if(args.action === "foreshadow")return {evidence:[{quote:"铜镜终于裂开了。",reason:"此前裂纹得到兑现"}]};
              return {text:args.action === "polish"?"润色后的文字。":"章节审核建议。"};
            }

            if (command === "initialize_storage") { for (const [key,value] of Object.entries(args.legacy || {})) if (!(key in store)) store[key]=value; return {...store}; }
            if (command === "write_storage") { if(args.value === null) delete store[args.key]; else store[args.key]=args.value; return; }

          calls.push({ command, args: copy(args) });
          if (command === "list_books")
            return [
              {
                id: "book-1",
                title: "我的旧稿",
                sourceType: "file",
                characterCount: 1000,
                createdAt: stamp,
                updatedAt: stamp,
                status: "ready",
                stage: "",
                completed: 0,
                total: 0,
                model: "",
                jobStartedAt: "",
                jobUpdatedAt: "",
              },
            ];
          if (command === "list_creations")
            return deleted ? [] : [
              {
                ...copy(project),
                chapterCount: project.documents.filter(
                  (d: any) => d.kind === "chapter",
                ).length,
                wordCount: 3000,
              },
            ];
          if (command === "delete_creation") {
            if (options.deleteBlocked) throw new Error("此作品正在运行 AI 任务，请等待任务结束后再删除");
            if (args.id !== project.id || args.revision !== project.revision) throw new Error("作品已有更新");
            deleted = true; tasks = []; versions = []; return null;
          }
          if (command === "read_creation_chapter") return copy(cycle(args.documentId));
          if (command === "creation_chapter_action") {
            const input = args.input, state = cycle(input.documentId);
            const doc = project.documents.find((d:any) => d.id === input.documentId);
            if (input.revision !== project.revision) throw new Error("作品已有新修改");
            if (input.action === "confirm_review") {
              const source = tasks.find(t => t.id === input.taskId);
              if (source && source.sourceContent !== doc.content) throw new Error("审稿基于旧稿");
              state.review = { id: `review-${project.revision}`, taskId: input.taskId || null, sourceContent: doc.content, issues: input.issues, createdAt: stamp };
            }
            if (input.action === "finalize") {
              const snapshot = { id: `final-${state.finalizations.length}`, title: doc.title, content: doc.content, createdAt: stamp, revision: project.revision };
              state.finalizations.push(snapshot); state.activeFinalization = snapshot.id;
            }
            if (input.action === "reopen") state.activeFinalization = null;
            if (input.action === "confirm_records") {
              const t = tasks.find(t => t.id === input.taskId);
              if (t.finalizationId !== state.activeFinalization || t.status !== "ready") throw new Error("记录不属于当前定稿");
              project.documents.push({ id: `record-${t.id}`, kind: "resource", title: `${doc.title} · 本章记录`, content: t.content, goal: "", volumeId: "", details: { category: "facts", status: "已确认", chapterId: doc.id, finalizationId: state.activeFinalization } });
              t.status = "accepted"; state.recordTaskIds.push(t.id);
            }
            project.revision++; return copy(project);
          }
          if (command === "get_creation") return copy(project);
          if (command === "creation_skills") return skills;
          if (command === "list_creation_tasks") return copy(tasks);
          if (command === "list_reading_clips")
            return [
              {
                id: "clip1",
                position: 0,
                chapterTitle: "第一章",
                quote: "一封信改变了他的决定。",
                note: "选择推动事件",
                paragraph: 0,
                createdAt: stamp,
                updatedAt: stamp,
              },
            ];
          if (command === "save_creation") {
            if (options.delaySave) await new Promise((r) => setTimeout(r, 350));
            if (project.revision !== args.project.revision)
              throw new Error("版本冲突");
            const next = copy(args.project);
            for (const d of next.documents)
              if (
                JSON.stringify(d) !==
                JSON.stringify(
                  project.documents.find((old: any) => old.id === d.id),
                )
              )
                versions.unshift({
                  ...d,
                  id: `version-${versions.length}`,
                  documentId: d.id,
                  reason: "编辑保存",
                  createdAt: stamp,
                });
            project = {
              ...next,
              revision: next.revision + 1,
              updatedAt: stamp,
            };
            return copy(project);
          }
          if (command === "generate_creation") {
            const task = {
              id: `task-${tasks.length}`,
              projectId: project.id,
              documentId: args.documentId,
              skill: args.skill,
              workflowMode: args.workflowMode, reviewId: args.reviewId, finalizationId: args.finalizationId,
              instruction: args.instruction,
              revision: args.revision,
              status: "running",
              content: "",
              error: "",
              context: "作品档案＋当前章节。本次不是全书审读。",
              sourceContent: project.documents.find(
                (d: any) => d.id === args.documentId,
              ).content,
              createdAt: stamp,
              model: "test-model",
            };
            tasks.unshift(task);
            setTimeout(() => {
              task.status =
                options.failedTask && tasks.length === 1 ? "failed" : "ready";
              task.content =
                task.status === "failed"
                  ? ""
                  : args.skill === "review"
                    ? "保留已有口吻，优先修复人物选择的因果。"
                    : args.skill === "memory"
                      ? "第一章：人物作出决定，原文依据待作者核对。"
                      : "这是 AI 候选正文，尚未覆盖作者内容。";
              task.error =
                task.status === "failed" ? "模型请求失败，正文仍保留" : "";
            }, 120);
            return copy(task);
          }
          if (command === "accept_creation_task") {
            const t = tasks.find((t) => t.id === args.taskId);
            if (
              t.status !== "ready" ||
              t.revision !== project.revision ||
              args.revision !== project.revision
            )
              throw new Error("候选已过期");
            const d = project.documents.find((d: any) =>
              t.skill === "memory" ? d.kind === "facts" : d.id === t.documentId,
            );
            d.content =
              args.mode === "append" && d.content
                ? `${d.content}\n\n${t.content}`
                : t.content;
            versions.unshift({
              ...d,
              id: `version-${versions.length}`,
              documentId: d.id,
              reason: "接受 AI 候选",
              createdAt: stamp,
            });
            project.revision++;
            t.status = "accepted";
            return copy(project);
          }
          if (command === "dismiss_creation_task") {
            tasks.find((t) => t.id === args.taskId).status = "dismissed";
            return null;
          }
          if (command === "creation_versions")
            return copy(
              versions.filter((v) => v.documentId === args.documentId),
            );
          if (command === "restore_creation_version") {
            const v = versions.find((v) => v.id === args.versionId);
            const d = project.documents.find((d: any) => d.id === v.documentId);
            d.content = v.content;
            d.title = v.title;
            d.goal = v.goal;
            project.revision++;
            return copy(project);
          }
          if (command === "create_creation") {
            project = {
              ...project,
              id: "created-project",
              title: args.input.title,
              genre: args.input.genre,
              audience: args.input.audience,
              revision: 0,
              documents: project.documents.map((d: any) => ({
                ...d,
                content:
                  d.kind === "brief"
                    ? args.input.seed
                    : args.input.content && args.input.importKind !== "settings" && args.input.importKind !== "reference" && d.id === "doc-6"
                      ? args.input.content
                      : "",
              })),
            };
            if (args.input.content && args.input.importKind !== "prose") {
              project.documents.push({ id: "import-resource", kind: "resource", title: args.input.sourceName, content: args.input.content, goal: "", volumeId: "", details: { category: "reference", status: "待确认", source: args.input.sourceName } });
              project.documents.push({ id: "import-source", kind: "source", title: args.input.sourceName, content: args.input.content, goal: "", volumeId: "", details: {} });
            }
            return copy(project);
          }
          if (command === "export_creation")
            return `/Downloads/${project.title}.${args.format}`;
          throw new Error(`Unexpected bridge call: ${command}`);
        },
      },
    };
  }, options);
}
async function openWorkspace(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "创作空间", exact: true }).click();
  await page.getByRole("button", { name: /长夜记录员 都市悬疑/ }).click();
  await expect(page.getByRole("tab", { name: "章节", exact: true })).toHaveAttribute("data-state", "active");
  await expect(page.getByLabel("章节正文", { exact: true })).toBeVisible();
}
async function chapter(page: Page) {
  await page.locator(".creation-doc-link").filter({ hasText: "第1章" }).click();
  await expect(page.getByLabel("章节正文", { exact: true })).toHaveValue(
    "这是作者的旧正文。",
  );
}
async function more(page: Page, name: string) {
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
}
async function collaborate(page: Page, action = "续写本章") {
  await page.getByRole("button", { name: action, exact: true }).click();
}
async function generate(page: Page, action = "续写本章") {
  await page.locator(".creation-assistant").getByRole("button", { name: action, exact: true }).click();
}

test("chapter preparation guides writing and chapter preparation persists", async ({ page }) => {
  await creationDesktop(page); await openWorkspace(page);
  await page.getByRole("tab", { name: "准备", exact: true }).click();
  await page.getByLabel("本章目标", { exact: true }).fill("确认来信来源");
  await page.getByLabel("主要阻力").fill("守门人拒绝交出档案");
  await page.getByLabel("本章结果").fill("主角决定潜入旧港");
  await expect.poll(() => page.evaluate(() => (window as any).__CREATION_TEST__.project.documents[6].details?.outcome)).toBe("主角决定潜入旧港");
  await page.screenshot({ path: "test-results/creation-preparation.png" });
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  await expect(page.getByLabel("章节正文")).toHaveValue("这是作者的旧正文。");
});

test("manual review, revision, finalization and reopening preserve the manuscript", async ({ page }) => {
  await creationDesktop(page); await openWorkspace(page);
  await page.getByRole("button", { name: "进入审稿" }).click();
  await page.getByRole("button", { name: "添加人工意见" }).click();
  await page.getByLabel("审稿意见1").fill("让人物的决定有具体依据。");
  await page.getByRole("button", { name: "确认意见，进入修订" }).click();
  await expect(page.getByRole("tab", { name: "修订", exact: true })).toHaveAttribute("data-state", "active");
  await expect(page.getByText("让人物的决定有具体依据。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "手动修改正文" }).click();
  await page.getByLabel("章节正文").fill("他从旧档案中发现了日期矛盾，因此决定回到旧港。");
  await page.getByRole("button", { name: "人工确认定稿" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("本章已定稿", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "草稿", exact: true }).click();
  await expect(page.getByLabel("章节正文")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "查看定稿与记录" }).click();
  await page.getByRole("button", { name: "创建修订版", exact: true }).click();
  await expect(page.getByLabel("章节正文")).not.toHaveAttribute("readonly", "");
  await page.getByLabel("章节正文").fill("新修订稿");
  await page.getByRole("tab", { name: "定稿", exact: true }).click();
  await page.getByText("历史定稿 · 1 版", { exact: true }).click();
  await page.locator("details").filter({ hasText: "2026/10/8" }).last().locator("summary").click();
  await expect(page.getByText("他从旧档案中发现了日期矛盾，因此决定回到旧港。", { exact: true })).toBeVisible();
});

test("AI review can be confirmed and used for a separate revision proposal", async ({ page }) => {
  await creationDesktop(page); await openWorkspace(page);
  await page.getByRole("button", { name: "进入审稿" }).click();
  await page.getByRole("button", { name: "检查本章", exact: true }).click();
  await page.locator(".workbench-assistant").getByRole("button", { name: "检查本章", exact: true }).click();
  await page.getByRole("button", { name: "选择审稿意见" }).click();
  await expect(page.getByLabel("审稿意见1")).toHaveValue(/保留已有口吻/);
  await page.getByRole("button", { name: "确认意见，进入修订" }).click();
  await page.getByRole("button", { name: "生成修订稿", exact: true }).click();
  await page.locator(".workbench-assistant").getByRole("button", { name: "生成修订稿", exact: true }).click();
  await page.getByRole("button", { name: "预览并采用" }).click();
  await expect(page.getByRole("dialog")).toContainText("这是作者的旧正文。");
  await page.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(page.getByLabel("章节正文")).toHaveValue("这是 AI 候选正文，尚未覆盖作者内容。");
  const call = await page.evaluate(() => (window as any).__CREATION_TEST__.calls.filter((c:any) => c.command === "generate_creation").at(-1));
  expect(call.args.reviewId).toMatch(/^review-/);
  expect(call.args.workflowMode).toBe(true);
});

test("editing after review prevents stale revision and after generation prevents stale overwrite", async ({ page }) => {
  await creationDesktop(page); await openWorkspace(page);
  await page.getByRole("button", { name: "进入审稿" }).click();
  await page.getByRole("button", { name: "添加人工意见" }).click();
  await page.getByLabel("审稿意见1").fill("补充依据");
  await page.getByRole("button", { name: "确认意见，进入修订" }).click();
  await page.getByRole("button", { name: "手动修改正文" }).click();
  await page.getByLabel("章节正文").fill("作者新的决定");
  await page.getByRole("tab", { name: "修订", exact: true }).click();
  await expect(page.getByText("尚无针对当前草稿确认的意见。")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成修订稿", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "草稿", exact: true }).click();
  await page.getByRole("button", { name: "续写本章", exact: true }).click();
  await page.locator(".workbench-assistant").getByRole("button", { name: "续写本章", exact: true }).click();
  await expect(page.getByRole("button", { name: "预览并采用" })).toBeVisible();
  await page.getByLabel("章节正文").fill("更晚的新正文");
  await page.getByRole("button", { name: "预览并采用" }).click();
  await expect(page.getByRole("button", { name: "确认采用", exact: true })).toBeDisabled();
});

test("records are generated from a finalization and confirmed before entering resources", async ({ page }) => {
  await creationDesktop(page); await openWorkspace(page);
  await page.getByRole("button", { name: "人工确认定稿" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "整理本章记录", exact: true }).click();
  await page.locator(".workbench-assistant").getByRole("button", { name: "整理本章记录", exact: true }).click();
  await page.getByRole("button", { name: "去核对记录" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__CREATION_TEST__.project.documents.filter((d:any) => d.kind === "resource").length)).toBe(0);
  await page.getByRole("button", { name: "核对后确认保存记录" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "准备下一章", exact: true }).click();
  await expect(page.getByLabel("文档名称")).toHaveValue("第2章");
  await page.getByRole("tab", { name: "资料库", exact: true }).click();
  await page.locator(".creation-resource-item").filter({ hasText: "本章记录" }).click();
  await expect(page.getByLabel("内容", { exact: true })).toHaveValue(/人物作出决定/);
});

test("serialized autosave, versions and focus survive the new chapter workspace", async ({ page }) => {
  await creationDesktop(page, { delaySave: true }); await openWorkspace(page);
  const body=page.getByLabel("章节正文",{exact:true});
  await body.fill("第一段"); await page.waitForTimeout(960); await body.fill("第一段，作者又写了第二段。");
  await expect.poll(()=>page.evaluate(()=>(window as any).__CREATION_TEST__.project.documents[6].content)).toBe("第一段，作者又写了第二段。");
  await more(page,"本章历史版本");
  await page.getByRole("combobox",{name:"选择历史版本"}).click();
  await page.getByRole("option",{name:/初始版本/}).click();
  await page.getByRole("button",{name:"恢复此版本"}).click();
  await expect(body).toHaveValue("这是作者的旧正文。");
  await page.getByRole("button",{name:"专注写作",exact:true}).click();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".creation-navigation")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".topbar")).toBeVisible();
  await page.setViewportSize({width:980,height:680});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("recovers unsaved text and keeps failed AI tasks retryable", async ({page})=>{
  await creationDesktop(page,{recovered:true,failedTask:true}); await openWorkspace(page);
  await expect(page.getByLabel("章节正文")).toHaveValue("上次尚未保存的段落。");
  await page.getByRole("button",{name:"续写本章",exact:true}).click();
  await page.locator(".workbench-assistant").getByRole("button",{name:"续写本章",exact:true}).click();
  await expect(page.getByTestId("creation-proposal")).toContainText("模型请求失败");
  await page.locator(".workbench-assistant").getByRole("button",{name:"续写本章",exact:true}).click();
  await expect(page.getByRole("button",{name:"预览并采用"})).toBeVisible();
  await expect(page.getByLabel("章节正文")).toHaveValue("上次尚未保存的段落。");
});

test("resources remain separately manageable and link to chapter preparation", async ({page})=>{
  await creationDesktop(page); await openWorkspace(page);
  await page.getByRole("tab",{name:"资料库",exact:true}).click();
  await page.getByRole("button",{name:"新增条目"}).click();
  await page.getByLabel("条目名称").fill("铜镜的裂纹");
  await page.getByLabel("内容",{exact:true}).fill("第二次穿梭后裂纹加深");
  await page.getByRole("combobox",{name:"条目类别"}).click();
  await page.getByRole("option",{name:"伏笔",exact:true}).click();
  await page.getByLabel("计划回收位置").fill("第二卷高潮");
  await page.getByRole("tab",{name:"章节",exact:true}).click();
  await page.getByRole("tab",{name:"准备",exact:true}).click();
  await page.getByRole("checkbox",{name:"铜镜的裂纹 待确认",exact:true}).check();
  await expect.poll(()=>page.evaluate(()=>(window as any).__CREATION_TEST__.project.documents[6].details?.relatedIds)).toMatch(/.+/);
  await page.getByRole("tab",{name:"资料库",exact:true}).click();
  await page.getByText("导入管理",{exact:true}).click();
  await page.getByRole("button",{name:"纠正导入用途"}).click();
  await page.getByRole("dialog").getByText("第2章",{exact:true}).click();
  await page.getByRole("button",{name:"转换 1 条"}).click();
  await expect(page.getByLabel("条目名称")).toHaveValue("第2章");
});

test("setting import opens resources directly and original remains read-only", async ({page})=>{
  await creationDesktop(page); await page.goto("/");
  await page.getByRole("button",{name:"创作空间",exact:true}).click();
  await page.getByRole("button",{name:"新建作品",exact:true}).click();
  const raw="# 设定总览\n说明。\n## 主角\n出生世界待定。";
  await page.locator('input[type="file"]').setInputFiles({name:"设定总览.md",mimeType:"text/markdown",buffer:Buffer.from(raw)});
  await expect(page.getByRole("combobox",{name:"文件用途"})).toContainText("设定与大纲");
  await page.getByRole("button",{name:"创建作品",exact:true}).click();
  await expect(page.getByRole("tab",{name:"资料库",exact:true})).toHaveAttribute("data-state","active");
  await page.getByRole("tab",{name:"资料库",exact:true}).click();
  await expect(page.getByLabel("内容",{exact:true})).toHaveValue(raw);
  await page.locator(".creation-resource-item").filter({hasText:"导入原文"}).click();
  await expect(page.locator(".creation-source-text")).toHaveText(raw);
  await expect(page.getByLabel("条目名称")).toHaveAttribute("readonly","");
});

test("chapter editor provides a quiet writing layout at desktop and narrow widths", async ({page})=>{
  await creationDesktop(page); await openWorkspace(page);
  await page.screenshot({animations:"disabled",path:"test-results/creation-workspace.png"});
  await page.getByRole("tab",{name:"故事准备",exact:true}).click();
  await page.screenshot({animations:"disabled",path:"test-results/creation-story.png"});
  await page.setViewportSize({width:980,height:680});
  await page.getByRole("tab",{name:"章节",exact:true}).click();
  await page.screenshot({animations:"disabled",path:"test-results/creation-980.png"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("creation deletion confirms scope, supports cancellation and clears local drafts", async ({ page }) => {
  await creationDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "创作空间", exact: true }).click();
  await page.getByRole("button", { name: "删除作品 长夜记录员", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("历史版本和 AI 记录");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: /长夜记录员 都市悬疑/ })).toBeVisible();
  await page.evaluate(() => { (window as any).__SQLITE_TEST__["inkscope-creation-draft-project-1"] = "draft"; (window as any).__SQLITE_TEST__["inkscope-creation-conflict-project-1"] = "conflict"; });
  await page.getByRole("button", { name: "删除作品 长夜记录员", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除作品", exact: true }).click();
  await expect(page.getByText("开始写你的第一部作品", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__SQLITE_TEST__["inkscope-creation-draft-project-1"] ?? null)).toBeNull();
  expect(await page.evaluate(() => (window as any).__SQLITE_TEST__["inkscope-creation-conflict-project-1"] ?? null)).toBeNull();
  await page.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(page.getByRole("button", { name: "我的旧稿", exact: true }).last()).toBeVisible();
});

test("blocked deletion keeps the project and dialog available", async ({ page }) => {
  await creationDesktop(page, { deleteBlocked: true }); await page.goto("/");
  await page.getByRole("button", { name: "创作空间", exact: true }).click();
  await page.getByRole("button", { name: "删除作品 长夜记录员", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认删除作品", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("正在运行 AI 任务");
  await page.screenshot({ path: "test-results/creation-delete-confirmation.png" });
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: "删除作品 长夜记录员", exact: true })).toBeVisible();
});

 test("blank creation has a minimal dialog and opens story preparation without a landing page", async ({page}) => {
  await creationDesktop(page); await page.goto("/");
  await page.getByRole("button",{name:"创作空间",exact:true}).click();
  await page.getByRole("button",{name:"新建作品",exact:true}).click();
  await expect(page.getByLabel("故事灵感")).toHaveCount(0);
  await expect(page.getByRole("combobox",{name:"导入书架稿件"})).not.toBeVisible();
  await page.getByLabel("作品名称").fill("新故事");
  await page.screenshot({animations:"disabled",path:"test-results/creation-new.png"});
  await page.getByRole("button",{name:"创建作品",exact:true}).click();
  await expect(page.getByRole("tab",{name:"故事准备",exact:true})).toHaveAttribute("data-state","active");
  await expect(page.getByRole("tab",{name:"总览",exact:true})).toHaveCount(0);
  await expect(page.getByLabel("故事简案")).toBeVisible();
  await page.getByRole("button",{name:"进入章节写作",exact:true}).click();
  await expect(page.getByRole("tab",{name:"准备",exact:true})).toHaveAttribute("data-state","active");
});

test("legacy storage migrates before rendering and is not written again", async ({page}) => {
  await creationDesktop(page, {recovered:true});
  await openWorkspace(page);
  expect(await page.evaluate(() => localStorage.getItem("inkscope-model"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("inkscope-creation-draft-project-1"))).toBeNull();
  await page.getByLabel("章节正文").fill("SQLite 中的新草稿");
  await expect.poll(() => page.evaluate(() => JSON.parse((window as any).__SQLITE_TEST__["inkscope-creation-draft-project-1"]).documents[6].content)).toBe("SQLite 中的新草稿");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
test("failed migration retains legacy data and supports retry", async ({page}) => {
 await creationDesktop(page);
 await page.addInitScript(() => {
   const original = (window as any).__TAURI__.core.invoke;
   let fail=true;
   (window as any).__TAURI__.core.invoke=async (command:string,args:any) => {
     if(command==="initialize_storage" && fail){fail=false;throw new Error("disk unavailable")}
     return original(command,args);
   };
 });
 await page.goto("/");
 await expect(page.getByText("本地 SQLite 存储初始化失败，已有数据未删除。请重试。")).toBeVisible();
 expect(await page.evaluate(() => localStorage.getItem("inkscope-model"))).not.toBeNull();
 await page.getByRole("button",{name:"重试",exact:true}).click();
 await expect(page.getByRole("button",{name:"创作空间",exact:true})).toBeVisible();
 expect(await page.evaluate(() => localStorage.getItem("inkscope-model"))).toBeNull();
});

async function openWriter(page:Page) {
 await page.goto('/'); await page.getByRole('button',{name:'写作',exact:true}).click();
 await page.getByRole('button',{name:/长夜记录员 都市悬疑/}).click();
 await expect(page.getByLabel('写作正文')).not.toHaveAttribute('readonly','');
}
async function selectWriter(page:Page,start:number,end:number) {
 await page.getByLabel('写作正文').evaluate((el:HTMLTextAreaElement,[start,end])=>{el.focus();el.setSelectionRange(start,end);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));},[start,end]);
 await expect(page.getByRole('button',{name:'标记伏笔',exact:true})).toBeVisible();
}
test('writer provides clean manual writing, chapter plans and recoverable deletion',async({page})=>{
 await creationDesktop(page);await openWriter(page);
 await expect(page.getByRole('tab',{name:'准备',exact:true})).toHaveCount(0);
 await page.getByLabel('写作正文').fill('第一章的人工正文。');
 await page.getByText('本章章纲',{exact:true}).click();await page.getByLabel('本章章纲').fill('人物作出选择。');
 await page.getByRole('button',{name:'新建分卷',exact:true}).click();await page.getByRole('textbox',{name:'分卷名称',exact:true}).fill('第二卷');await page.getByRole('button',{name:'保存名称',exact:true}).click();
 await page.getByRole('button',{name:'向第二卷新建章节',exact:true}).click();await page.getByLabel('章节标题').fill('新章节');await page.getByLabel('写作正文').fill('保留这段正文。');
 await page.getByRole('button',{name:'删除章节新章节',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
 await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('tab',{name:/回收站 ·/}).click();
 await page.getByRole('button',{name:'恢复',exact:true}).click();await page.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.writer-chapter-link').getByText('新章节',{exact:true}).click();await expect(page.getByLabel('写作正文')).toHaveValue('保留这段正文。');
 await page.screenshot({animations:'disabled',path:'test-results/writer-workspace.png'});
});
test('foreshadow links preserve quote positions, status and deleted source recovery',async({page})=>{
 await creationDesktop(page);await openWriter(page);const text='铜镜上出现一道裂纹。\n铜镜终于裂开了。';
 await page.getByLabel('写作正文').fill(text);await selectWriter(page,0,11);
 await page.getByRole('button',{name:'标记伏笔',exact:true}).click();await page.getByLabel('伏笔名称',{exact:true}).fill('铜镜裂纹');await page.getByRole('button',{name:'保存伏笔',exact:true}).click();await expect(page.getByRole('dialog',{name:'伏笔集合'})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'伏笔集合'}).getByLabel('伏笔名称',{exact:true})).toHaveValue('铜镜裂纹');
 await page.getByRole('button',{name:'关闭',exact:true}).click();await selectWriter(page,12,text.length);await page.getByRole('button',{name:'关联回收位置',exact:true}).click();await page.getByRole('button',{name:/^伏笔 /}).click();
 await page.getByRole('combobox',{name:'回收状态'}).click();await page.getByRole('option',{name:'已回收',exact:true}).click();
 await page.getByRole('button',{name:'返回埋设位置',exact:true}).click();await expect.poll(()=>page.getByLabel('写作正文').evaluate((e:HTMLTextAreaElement)=>e.value.slice(e.selectionStart,e.selectionEnd))).toBe(text.slice(0,11));
 await page.getByRole('button',{name:/^伏笔 /}).click();await page.screenshot({animations:'disabled',path:'test-results/writer-foreshadow.png'});await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'删除章节第1章',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
 await page.getByRole('button',{name:/^伏笔 /}).click();await page.getByRole('button',{name:'返回埋设位置',exact:true}).click();await expect(page.getByRole('alert')).toContainText('关联章节已删除，可先从回收站恢复。');
});
test('writer AI names, completion and review remain optional',async({page})=>{
 await creationDesktop(page);await openWriter(page);await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('tab',{name:'人物取名',exact:true}).click();
 await page.getByLabel('指定姓氏').fill('林');await page.getByRole('button',{name:'生成十个名字',exact:true}).click();await expect(page.getByRole('button',{name:'存为人物',exact:true})).toHaveCount(10);
 await page.getByRole('button',{name:'存为人物',exact:true}).first().click();await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'写作辅助',exact:true}).click();await page.getByRole('checkbox',{name:/FIM 补全/}).check();await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByLabel('写作正文').fill('夜色降临，');await expect(page.locator('.writer-completion')).toContainText('他终于推开了门。');await page.getByRole('button',{name:'Tab 接受',exact:true}).click();await expect(page.getByLabel('写作正文')).toHaveValue('夜色降临，他终于推开了门。');
 await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('tab',{name:'章节审核',exact:true}).click();await page.getByRole('button',{name:'审核所选章节',exact:true}).click();await expect(page.getByRole('dialog',{name:'章节审核',exact:true})).toContainText('章节审核建议。');
});

test('writer archive restores chapters and canonical notes without overwriting new content',async()=>{
 const {archive,restore,updateAnchors}=await import('../../src/lib/writer');
 const p:any={id:'p',volumes:[{id:'v',title:'第一卷'}],documents:[{id:'c',kind:'chapter',title:'第一章',content:'正文',goal:'目标',volumeId:'v',details:{}},{id:'r',kind:'rules',title:'世界规则',content:'原设定',goal:'',volumeId:'',details:{}}]};
 const removed=archive(p,['c']);expect(removed.documents[0].details.category).toBe('trash');expect(restore(removed,'c').documents[0]).toMatchObject({kind:'chapter',content:'正文',volumeId:'v'});
 const cleared=archive(p,['r']);expect(cleared.documents.find(d=>d.id==='r')!.content).toBe('');const snapshot=cleared.documents.find(d=>d.details?.originalKind==='canonical')!;
 expect(restore(cleared,snapshot.id).documents.find(d=>d.id==='r')!.content).toBe('原设定');cleared.documents.find(d=>d.id==='r')!.content='新的设定';expect(()=>restore(cleared,snapshot.id)).toThrow(/避免覆盖/);
 const mark:any={id:'m',kind:'resource',details:{category:'foreshadow',chapterId:'c',quote:'铜镜',start:'0'}};
 expect(updateAnchors([mark],'c','前言铜镜')[0].details?.start).toBe('2');expect(updateAnchors([mark],'c','前言铜镜和铜镜')[0].details?.anchorState).toBe('需重新定位');expect(updateAnchors([mark],'c','原文已删')[0].details?.anchorState).toBe('需重新定位');
});

test('writer volume deletion can preserve chapters and restores the removed volume',async({page})=>{
 await creationDesktop(page);await openWriter(page);
 await page.getByRole('button',{name:'删除分卷第一卷',exact:true}).click();
 await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.writer-volume')).toContainText('未分卷');await expect(page.getByLabel('写作正文')).toHaveValue('这是作者的旧正文。');
 await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('tab',{name:/回收站 ·/}).click();await page.getByRole('button',{name:'恢复',exact:true}).click();
 await page.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.writer-volume').filter({hasText:'第一卷'})).toBeVisible();
 await page.setViewportSize({width:980,height:680});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'专注写作',exact:true}).click();await expect(page.getByRole('navigation',{name:'写作目录'})).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.getByRole('navigation',{name:'写作目录'})).toBeVisible();
});

test('writer separates manuscript from material pages and edits one setting at a time', async({page})=>{
 await creationDesktop(page); await openWriter(page);
 await page.getByLabel('写作正文').fill('长夜里的第一段正文。');
 const directory = await page.getByRole('navigation',{name:'写作目录'}).boundingBox();
 const manuscript = await page.getByLabel('写作正文').boundingBox();
 expect(manuscript!.x).toBeGreaterThan(directory!.x + directory!.width);
 expect(manuscript!.y + manuscript!.height).toBeLessThanOrEqual(820);
 expect(manuscript!.height).toBeGreaterThan(200);
 await page.getByRole('button',{name:'设定',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'设定背景'})).toBeVisible();
 await expect(page.locator('.writer-material-index')).toBeVisible();
 await expect(page.locator('.writer-panel-content textarea')).toHaveCount(1);
 await page.getByRole('button',{name:'新增条目',exact:true}).click();
 await page.locator('.writer-panel-content textarea').fill('只有月圆时才能使用这条规则。');
 await page.screenshot({animations:'disabled',path:'test-results/writer-materials.png'});
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page.getByLabel('写作正文')).toHaveValue('长夜里的第一段正文。');
 await page.setViewportSize({width:980,height:760});
 await page.screenshot({animations:'disabled',path:'test-results/writer-980.png'});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('writer respects reduced motion and keeps navigation beside the manuscript',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'}); await creationDesktop(page); await openWriter(page);
 await expect(page.getByRole('navigation',{name:'写作目录'}).getByRole('button',{name:'设定',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'设定',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'设定背景'})).toBeVisible();
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByLabel('写作正文').fill('夜色落在窗沿。');
 await expect(page.locator('.writer-manuscript-label')).toContainText('7 字');
});

test('writer volume descriptions persist and tools show one dedicated function', async({page})=>{
 await creationDesktop(page);await openWriter(page);
 await page.getByRole('button',{name:'第一卷',exact:true}).click();
 await page.getByLabel('卷描述',{exact:true}).fill('进入失落的旧城。');await page.getByLabel('本卷目标',{exact:true}).fill('找出铜镜的主人。');
 await page.getByRole('button',{name:'保存名称',exact:true}).click();await expect(page.locator('.writer-volume-goal')).toContainText('找出铜镜的主人。');
 await page.getByRole('button',{name:'第一卷',exact:true}).click();await expect(page.getByLabel('卷描述',{exact:true})).toHaveValue('进入失落的旧城。');await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'工具',exact:true}).click();await expect(page.getByLabel('指定姓氏')).toBeVisible();
 await page.getByRole('tab',{name:'章节审核',exact:true}).click();await expect(page.getByLabel('指定姓氏')).toHaveCount(0);await expect(page.getByRole('button',{name:'审核所选章节'})).toBeVisible();
 await page.getByRole('tab',{name:'文字润色',exact:true}).click();await expect(page.getByRole('button',{name:'审核所选章节'})).toHaveCount(0);await expect(page.getByRole('button',{name:'润色当前章'})).toBeVisible();
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByLabel('指定姓氏').fill('林');await page.getByRole('button',{name:'生成十个名字'}).click();await expect(page.getByRole('button',{name:'复制',exact:true})).toHaveCount(10);await page.screenshot({animations:'disabled',path:'test-results/writer-names.png'});
});
