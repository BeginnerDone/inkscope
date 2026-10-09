import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { testModel } from "@/lib/tauri";
import type { ModelConfig } from "@/types";
import { Check, KeyRound, LoaderCircle, Zap } from "lucide-react";
import { useState } from "react";

export function SettingsModal({
  value,
  onClose,
  onSave,
}: {
  value: ModelConfig;
  onClose: () => void;
  onSave: (config: ModelConfig) => void;
}) {
  const restoreFocus = useDialogFocus();
  const [form, setForm] = useState(value);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const update = (next: Partial<ModelConfig>) => {
    setForm((current) => ({ ...current, ...next }));
    setStatus(null);
  };
  const test = async () => {
    if (testing) return;
    setTesting(true);
    setStatus(null);
    try {
      const success = await testModel(form);
      setStatus({
        success,
        message: success
          ? "连接成功，可以开始分析与创作。"
          : "模型未返回预期结果。",
      });
    } catch (e) {
      setStatus({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle>模型与设置</DialogTitle>
          <DialogDescription>
            连接 DeepSeek，用于书籍分析、原创策划与章节协作。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="api-key">API Key</FieldLabel>
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              disabled={testing}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder="sk-…"
            />
            <FieldDescription className="flex items-start gap-2">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" />
              密钥仅保存在当前设备，不写入书籍文件。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="model-name">模型</FieldLabel>
            <Select
              value={form.model}
              disabled={testing}
              onValueChange={(model) =>
                update({ model: model as ModelConfig["model"] })
              }
            >
              <SelectTrigger id="model-name" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="deepseek-v4-flash">
                    DeepSeek V4 Flash
                  </SelectItem>
                  <SelectItem value="deepseek-v4-pro">
                    DeepSeek V4 Pro
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="base-url">API 地址</FieldLabel>
            <Input
              id="base-url"
              value={form.baseUrl}
              disabled={testing}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com"
            />
          </Field>
        </FieldGroup>
        {status && (
          <Alert variant={status.success ? "default" : "destructive"}>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!form.apiKey.trim() || testing}
            onClick={() => void test()}
          >
            {testing ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Zap data-icon="inline-start" />
            )}
            {testing ? "正在测试…" : "测试连接"}
          </Button>
          <Button
            disabled={!form.apiKey.trim() || testing}
            onClick={() => onSave(form)}
          >
            <Check data-icon="inline-start" />
            保存设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
