import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { CreationDoc, CreationProject } from "./lib/creation";
const categories = { all: "全部资料", brief: "作品构想", characters: "人物", rules: "世界与规则", foreshadow: "伏笔", facts: "正文事实", reference: "参考资料", style: "写作约定", source: "导入原文" };
const categoryOf = (d: CreationDoc) => d.kind === "resource" ? d.details?.category || "reference" : d.kind;
export function CreationResources({ project, onChange, onSelect, selectedId }: { project: CreationProject; onChange: (fn: (p: CreationProject) => CreationProject) => void; onSelect: (d: CreationDoc) => void; selectedId: string; }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const selected = selectedId;
  const [convert, setConvert] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const entries = project.documents.filter(d => !["chapter", "outline"].includes(d.kind) && (["brief", "resource", "source"].includes(d.kind) || !!d.content.trim()));
  const visible = entries.filter(d => (category === "all" || categoryOf(d) === category) && `${d.title} ${d.content}`.toLowerCase().includes(query.toLowerCase()));
  const doc = entries.find(d => d.id === selected);
  const update = (patch: Partial<CreationDoc>) => onChange(p => ({ ...p, documents: p.documents.map(d => d.id === selected ? { ...d, ...patch } : d) }));
  const detail = (key: string, value: string) => update({ details: { ...doc?.details, [key]: value } });
  const add = () => {
    const type = ["all", "brief", "source"].includes(category) ? "reference" : category;
    const entry: CreationDoc = { id: crypto.randomUUID(), kind: "resource", title: `新${categories[type as keyof typeof categories]}`, content: "", goal: "", volumeId: "", details: { category: type, status: type === "foreshadow" ? "计划中" : "待确认" } };
    onChange(p => ({ ...p, documents: [...p.documents, entry] })); onSelect(entry); setQuery("");
  };
  return <section className="creation-resources">
    <header className="creation-resources-toolbar"><div><strong>资料库</strong><p>逐条管理人物、规则、伏笔和参考资料。</p></div><div><details className="creation-resource-tools"><summary>导入管理</summary><Button variant="ghost" size="sm" onClick={() => { setChosen([]); setConvert(true); }}>纠正导入用途</Button></details></div></header>
    <div className="creation-resources-body"><aside className="creation-resources-index">
      <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="资料类别"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(categories).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <Input aria-label="搜索资料" placeholder="搜索资料…" value={query} onChange={e => setQuery(e.target.value)} />
      <Button variant="outline" size="sm" onClick={add}><Plus />新增条目</Button>
      <div className="creation-resources-items">{visible.map(d => <Button className="creation-resource-item" key={d.id} variant={selected === d.id ? "secondary" : "ghost"} onClick={() => onSelect(d)}><span>{d.title}</span><small>{categories[categoryOf(d) as keyof typeof categories]} · {d.kind === "source" ? "原文" : d.details?.status || "作者维护"}</small></Button>)}{!visible.length && <p>没有符合条件的资料。可以新增条目，或调整筛选。</p>}</div>
    </aside><main className="creation-resource-detail">{doc ? <FieldGroup key={doc.id}>
      <Field><FieldLabel htmlFor="resource-title">条目名称</FieldLabel><Input id="resource-title" readOnly={doc.kind === "source"} value={doc.title} onChange={e => update({ title: e.target.value })} /></Field>
      {doc.kind === "resource" && <div className="creation-form-pair"><Field><FieldLabel>类别</FieldLabel><Select value={doc.details?.category || "reference"} onValueChange={v => detail("category", v)}><SelectTrigger aria-label="条目类别"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(categories).filter(([k]) => !["all", "brief", "source"].includes(k)).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel>状态</FieldLabel><Select value={doc.details?.status || "待确认"} onValueChange={v => detail("status", v)}><SelectTrigger aria-label="条目状态"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["待确认", "已确认", "计划中", "已埋设", "推进中", "已回收", "已弃用"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div>}
      <Field><FieldLabel htmlFor="resource-content">{doc.kind === "source" ? "原始文档（只读）" : "内容"}</FieldLabel>{doc.kind === "source" ? <pre className="creation-source-text">{doc.content}</pre> : <Textarea id="resource-content" rows={12} value={doc.content} onChange={e => update({ content: e.target.value })} placeholder="一条资料记录一个主题；人物可记录欲望、关系和能力边界，规则可记录条件、代价与例外。" />}<FieldDescription>{doc.kind === "source" ? "保留导入时的完整文本；整理后的内容在其他条目中编辑。" : "自动保存。导入的设定默认待确认，不会自动成为正文事实。"}</FieldDescription></Field>
      {doc.kind !== "source" && <><Field><FieldLabel htmlFor="resource-source">来源与依据</FieldLabel><Input id="resource-source" value={doc.details?.source || ""} onChange={e => detail("source", e.target.value)} placeholder="文件、章节或作者说明" /></Field>
      {categoryOf(doc) === "foreshadow" && <div className="creation-form-pair"><Field><FieldLabel htmlFor="foreshadow-planted">实际埋设位置</FieldLabel><Input id="foreshadow-planted" value={doc.details?.introduced || ""} onChange={e => detail("introduced", e.target.value)} placeholder="如第三章某段；尚未写入请留空" /></Field><Field><FieldLabel htmlFor="foreshadow-recovery">计划回收位置</FieldLabel><Input id="foreshadow-recovery" value={doc.details?.recovery || ""} onChange={e => detail("recovery", e.target.value)} placeholder="如第二卷高潮；这是计划" /></Field></div>}
      <Field><FieldLabel htmlFor="resource-notes">备注与待解决问题</FieldLabel><Textarea id="resource-notes" rows={3} value={doc.details?.note || ""} onChange={e => detail("note", e.target.value)} /></Field></>}
    </FieldGroup> : <p>选择左侧资料，或新增人物、规则、伏笔等条目。</p>}</main></div>
    <Dialog open={convert} onOpenChange={setConvert}><DialogContent className="creation-dialog"><DialogHeader><DialogTitle>将误导入的章节转为资料</DialogTitle><DialogDescription>只转换勾选的条目。当前内容与历史版本保留，转换后不计入正文字数。真实正文请勿勾选。</DialogDescription></DialogHeader><div className="creation-convert-list">{project.documents.filter(d => d.kind === "chapter").map(d => <label key={d.id}><Checkbox checked={chosen.includes(d.id)} onCheckedChange={v => setChosen(ids => v === true ? [...ids, d.id] : ids.filter(id => id !== d.id))} />{d.title}</label>)}</div><DialogFooter><Button variant="outline" onClick={() => setConvert(false)}>取消</Button><Button disabled={!chosen.length} onClick={() => { onChange(p => ({ ...p, documents: p.documents.map(d => chosen.includes(d.id) ? { ...d, kind: "resource", volumeId: "", details: { ...d.details, category: "reference", status: "待确认", source: "原正文条目转换" } } : d) })); onSelect({ ...project.documents.find(d => d.id === chosen[0])!, kind: "resource", volumeId: "" }); setCategory("all"); setConvert(false); }}>转换 {chosen.length} 条</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
