import { Menu, Import } from "lucide-react";
import { useAppContext } from "../data";
import { useTranslation } from "../i18n";
import { formatDisplayDateTime } from "../utils/dateFormat";

/**
 * 移动端唯一顶栏（spec mobile-responsive US-03，决策 7）：左菜单 / 中标题+更新时间 / 右导入。
 * `md:hidden`，桌面不出现。标题/时间数据源同时兼容对话与文档（B1 顶栏双实现统一）：
 * 对话页 `ChatBody` 自带 header 与文档页 `TopToolbar` 在 `< md` 均隐藏，由此处承接。
 */
export function MobileTopBar() {
  const {
    activeView,
    conversations,
    activeConversationId,
    documents,
    activeDocId,
    setMobileNavOpen,
    setDrawerOpen,
  } = useAppContext();
  const { t, language } = useTranslation();

  const isDoc = activeView === "doc";
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const activeDoc = documents.find((d) => d.id === activeDocId);
  const title = isDoc ? activeDoc?.title : activeConv?.title;
  const updatedAt = isDoc ? activeDoc?.updatedAt : activeConv?.updatedAt;

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-zinc-200 bg-white/90 px-1 backdrop-blur-md dark:border-white/10 dark:bg-[#1A1A1A]/90 md:hidden">
      <button
        onClick={() => setMobileNavOpen(true)}
        aria-label={t("mobile.openMenu")}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
      >
        <Menu size={20} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-1 text-center">
        <span className="w-full truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {title || "PenTou"}
        </span>
        {updatedAt && (
          <span className="w-full truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            {t("version.updatedAt", { time: formatDisplayDateTime(updatedAt, language) })}
          </span>
        )}
      </div>

      <button
        onClick={() => setDrawerOpen(true)}
        aria-label={t("mobile.import")}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
      >
        <Import size={20} />
      </button>
    </header>
  );
}
