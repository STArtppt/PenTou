import { Star } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/IconTooltip";
import { useTranslation } from "../i18n";

/**
 * 顶栏收藏按钮（spec content-favorites）。
 *
 * 四处入口（对话/文档 × 桌面/移动）共用它 —— 状态呈现、可访问名称、失败提示只此一份，
 * 免得三处各写一遍再各自漂移。切换本身乐观更新（见 data.tsx 的 toggle*Favorite），
 * 这里只负责在失败抛出时提示：状态回滚已由 data 层完成。
 */
export function FavoriteButton({
  favorite,
  disabled,
  onToggle,
  form = "toolbar",
}: {
  favorite: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => Promise<void>;
  /** `mobile` 用 44px 触控尺寸，与移动端顶栏其余按钮一致。 */
  form?: "toolbar" | "mobile";
}) {
  const { t } = useTranslation();
  const label = favorite ? t("favorite.remove") : t("favorite.add");

  const handleClick = async () => {
    try {
      await onToggle(!favorite);
    } catch {
      toast.error(t("favorite.failed"));
    }
  };

  const icon = (
    <Star
      size={form === "mobile" ? 20 : 16}
      // 已收藏＝实心：只靠颜色区分在深色模式与色觉障碍下都不够
      className={clsx(favorite && "fill-current text-amber-500")}
    />
  );

  if (form === "mobile") {
    return (
      <IconTooltip label={label}>
        <button
          onClick={handleClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={favorite}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10"
        >
          {icon}
        </button>
      </IconTooltip>
    );
  }

  return (
    <IconTooltip label={label}>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={favorite}
        className="size-8 shrink-0 text-muted-foreground"
      >
        {icon}
      </Button>
    </IconTooltip>
  );
}
