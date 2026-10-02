import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { LegadoSource } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE = 50;
export const SOURCE_LIMIT = 60;
export const defaultSources = (sources: LegadoSource[]) =>
  sources
    .filter((source) => source.searchCompatible && source.importCompatible)
    .slice(0, 30)
    .map((source) => source.key);

export function SourcePicker({
  sources,
  selected,
  onChange,
  disabled,
}: {
  sources: LegadoSource[];
  selected: string[];
  onChange: (keys: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(
    () =>
      sources.filter(
        (source) =>
          source.searchCompatible &&
          (filter !== "importable" || source.importCompatible) &&
          (filter !== "selected" || selectedSet.has(source.key)) &&
          `${source.name} ${source.group} ${source.url}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [sources, query, filter, selectedSet],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const available = visible.filter((source) => !selectedSet.has(source.key));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <SlidersHorizontal data-icon="inline-start" />
          书源范围 · {selected.length}
        </Button>
      </DialogTrigger>
      <DialogContent className="source-manager">
        <DialogHeader>
          <DialogTitle>选择搜索书源</DialogTitle>
          <DialogDescription>
            可从全部书源中选择，单次最多 {SOURCE_LIMIT}{" "}
            个。选得越多，等待通常越久。
          </DialogDescription>
        </DialogHeader>
        <div className="source-manager-filters">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="筛选书源"
              placeholder="按名称、分组或网址筛选…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </InputGroup>
          <Select
            value={filter}
            onValueChange={(value) => {
              setFilter(value);
              setPage(0);
            }}
          >
            <SelectTrigger aria-label="书源类型">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部可搜索</SelectItem>
                <SelectItem value="importable">可导入</SelectItem>
                <SelectItem value="selected">已选书源</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="source-manager-actions">
          <span role="status">
            {selected.length} / {SOURCE_LIMIT} 已选 · 匹配{" "}
            {filtered.length.toLocaleString()} 个
          </span>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                disabled || !available.length || selected.length >= SOURCE_LIMIT
              }
              onClick={() =>
                onChange([
                  ...selected,
                  ...available
                    .slice(0, SOURCE_LIMIT - selected.length)
                    .map((source) => source.key),
                ])
              }
            >
              补选本页
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(defaultSources(sources))}
            >
              默认 30 个
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || !selected.length}
              onClick={() => onChange([])}
            >
              清空
            </Button>
          </div>
        </div>
        <FieldSet
          className="source-manager-list"
          key={`${query}-${filter}-${currentPage}`}
        >
          <FieldLegend className="sr-only">书源选择</FieldLegend>
          {visible.map((source) => {
            const checked = selectedSet.has(source.key);
            return (
              <div
                className="source-row"
                data-selected={checked}
                key={source.key}
              >
                <Checkbox
                  id={`source-${source.key}`}
                  checked={checked}
                  disabled={
                    disabled || (!checked && selected.length >= SOURCE_LIMIT)
                  }
                  onCheckedChange={(value) =>
                    onChange(
                      value === true
                        ? [...selected, source.key].slice(0, SOURCE_LIMIT)
                        : selected.filter((key) => key !== source.key),
                    )
                  }
                />
                <Label htmlFor={`source-${source.key}`}>
                  <b title={source.name}>{source.name}</b>
                  <small title={source.reason || source.url}>
                    {source.reason || source.group || source.url}
                  </small>
                </Label>
                <Badge variant="secondary">
                  {source.importCompatible ? "可导入" : "仅搜索"}
                </Badge>
              </div>
            );
          })}
          {!visible.length && <div className="list-empty">没有匹配的书源</div>}
        </FieldSet>
        <footer className="source-manager-footer">
          <div className="source-pagination">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="上一页书源"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              第 {currentPage + 1} / {pages} 页
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="下一页书源"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <Button onClick={() => setOpen(false)}>完成选择</Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
