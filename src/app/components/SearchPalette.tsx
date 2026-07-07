/**
 * SearchPalette.tsx — 居中偏上命令面板式全文检索浮层（spec hybrid-search §4.6 / US-01,02）。
 *
 * 形态：未输入=窄"胶囊"；输入/有结果/空态/建索引=向下展开为大圆角卡片（上下对称）。
 * 交互：200ms 防抖 + AbortController 防竞态；building 状态退避轮询；Esc/遮罩关闭、焦点归位。
 * 视觉：刻意中性高级灰（不沿用全局 orange/yellow 主题）+ 毛玻璃模糊遮罩（§4.6）。
 * 高亮：片段按服务端 snippetParts.matched 渲染（非 innerHTML，防 XSS，§4.3/决策6）。
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, Bot, FileText, Loader2, SearchX, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useAppContext } from "../data";
import { useTranslation } from "../i18n";
import { formatDisplayMonthDay } from "../utils/dateFormat";

interface SnippetPart { text: string; matched: boolean; }
interface SearchHit {
  type: "conversation" | "document";
  id: string;
  title: string;
  date?: string;
  snippetParts: SnippetPart[];
  snippetText: string;
  score: number;
  matchReason?: "lex" | "semantic" | "both"; // Phase 2：纯语义命中渲染"语义相关"角标（spec §4.7）
}
type Status = "idle" | "loading" | "ready" | "building" | "error";
type Notice = "degraded" | "partial" | null; // Phase 2：混合检索降级 / 语义在建非阻塞提示

const DEBOUNCE_MS = 200;
const TOKEN_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]+|[a-zA-Z0-9]+/g;

/** 客户端把标题按 query 命中词拆成 {text,matched}[]（用于标题高亮，与片段一致风格）。 */
function highlightTitle(title: string, query: string): SnippetPart[] {
  const runs = [...query.matchAll(TOKEN_RE)].map((m) => m[0]).filter(Boolean);
  if (runs.length === 0) return [{ text: title, matched: false }];
  const escaped = runs
    .map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts: SnippetPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    if (m.index > last) parts.push({ text: title.slice(last, m.index), matched: false });
    parts.push({ text: m[0], matched: true });
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last < title.length) parts.push({ text: title.slice(last), matched: false });
  return parts;
}

function HighlightedParts({ parts, className, matchedClassName }: {
  parts: SnippetPart[];
  className?: string;
  matchedClassName: string;
}) {
  return (
    <>
      {parts.map((p, i) =>
        p.matched ? (
          <strong key={i} className={matchedClassName}>{p.text}</strong>
        ) : (
          <span key={i} className={className}>{p.text}</span>
        ),
      )}
    </>
  );
}

function formatHitDate(iso: string | undefined, language: "en" | "zh"): string {
  return formatDisplayMonthDay(iso, language);
}

export function SearchPalette() {
  const {
    searchOpen, setSearchOpen, setSearchJump,
    setActiveView, setActiveConversationId, setActiveDocId,
    conversations, documents, embeddingConfig,
  } = useAppContext();
  const { t, language } = useTranslation();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [notice, setNotice] = useState<Notice>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const hybrid = !!embeddingConfig?.enabled; // 语义检索已开启 → 走 hybrid（spec §4.7）

  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = query.trim().length > 0;

  const clearPoll = () => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
  };

  const runSearch = useCallback((q: string, attempt = 0) => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (attempt === 0) setStatus("loading");

    const modeParam = hybrid ? "&mode=hybrid" : "";
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=30${modeParam}`, {
      credentials: "include",
      signal: ac.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`search ${r.status}`);
        return r.json();
      })
      .then((data: { status: "ready" | "building"; hits: SearchHit[]; degraded?: boolean; partial?: boolean }) => {
        if (seq !== seqRef.current) return; // 旧请求结果丢弃（竞态）
        if (data.status === "building") {
          setStatus("building");
          const delay = Math.min(600 * 2 ** attempt, 3000); // 退避轮询，封顶 3s
          clearPoll();
          pollRef.current = setTimeout(() => runSearch(q, attempt + 1), delay);
          return;
        }
        clearPoll();
        setHits(data.hits ?? []);
        // 混合检索非阻塞提示：降级（本应语义却退字面）优先于 partial（语义在建）（spec §4.7）。
        setNotice(data.degraded ? "degraded" : data.partial ? "partial" : null);
        setActiveIndex(0);
        setStatus("ready");
      })
      .catch((e) => {
        if (ac.signal.aborted || seq !== seqRef.current) return;
        clearPoll();
        setStatus("error");
        console.error({ module: "SearchPalette", op: "runSearch", err: String(e) });
      });
  }, [hybrid]);

  // 防抖触发检索；空 query → 回到胶囊空闲态。
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      clearPoll();
      abortRef.current?.abort();
      seqRef.current++;
      setHits([]);
      setNotice(null);
      setStatus("idle");
      return;
    }
    const timer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  // 打开时聚焦输入并记住触发元素；关闭时清空并把焦点还回去（US-01 AC3）。
  useEffect(() => {
    if (searchOpen) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setHits([]);
      setNotice(null);
      setStatus("idle");
      clearPoll();
      abortRef.current?.abort();
      prevFocusRef.current?.focus?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  useEffect(() => () => { clearPoll(); abortRef.current?.abort(); }, []);

  const close = () => setSearchOpen(false);

  const pickHit = (hit: SearchHit) => {
    const exists = hit.type === "conversation"
      ? conversations.some((c) => c.id === hit.id)
      : documents.some((d) => d.id === hit.id);
    if (!exists) {
      // 索引滞后：命中目标已删除（US-03 AC3）——提示并刷新结果，不跳转。
      import("sonner").then(({ toast }) => toast.error(t("search.deleted")));
      runSearch(query.trim());
      return;
    }
    setActiveView(hit.type === "conversation" ? "chat" : "doc");
    if (hit.type === "conversation") setActiveConversationId(hit.id);
    else setActiveDocId(hit.id);
    setSearchJump({ type: hit.type, id: hit.id, snippetText: hit.snippetText });
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => (i + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === "Enter") { e.preventDefault(); const h = hits[activeIndex]; if (h) pickHit(h); }
  };

  if (!searchOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="search-overlay"
        className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh] bg-zinc-900/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <motion.div
          key="search-card"
          className={clsx(
            "w-full max-w-[640px] bg-white dark:bg-[#1F1F1F] shadow-2xl ring-1 ring-zinc-200 dark:ring-white/10 overflow-hidden transition-[border-radius] duration-200",
            expanded ? "rounded-2xl" : "rounded-full",
          )}
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {/* 无界输入区：不画框线，靠留白与两端图标勾勒（§4.6.3） */}
          <div className="flex items-center gap-3 px-5 h-14">
            <Search size={18} className="shrink-0 text-zinc-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("search.placeholder")}
              className="flex-1 bg-transparent outline-none border-0 text-[15px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
            />
            {query && (
              <button
                onMouseDown={(e) => { e.preventDefault(); setQuery(""); inputRef.current?.focus(); }}
                className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                aria-label="Clear"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="border-t border-zinc-100 dark:border-white/10"
              >
                <div className="max-h-[52vh] overflow-y-auto custom-scrollbar p-2">
                  {status === "ready" && notice && (
                    <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-zinc-50 dark:bg-white/5 px-3 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                      <Sparkles size={12} className="shrink-0" />
                      {t(notice === "degraded" ? "search.degraded" : "search.partial")}
                    </div>
                  )}

                  {status === "loading" && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                  )}

                  {status === "building" && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
                      <Loader2 size={16} className="animate-spin" />
                      {t("search.building")}
                    </div>
                  )}

                  {status === "error" && (
                    <div className="py-12 text-center text-sm text-zinc-400">{t("search.error")}</div>
                  )}

                  {status === "ready" && hits.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-3 py-14 text-zinc-300 dark:text-zinc-600">
                      <SearchX size={28} strokeWidth={1.5} />
                      <span className="text-sm text-zinc-400 dark:text-zinc-500">{t("search.empty")}</span>
                    </div>
                  )}

                  {status === "ready" && hits.length > 0 && (
                    <ul className="space-y-0.5">
                      {hits.map((hit, i) => (
                        <li key={`${hit.type}-${hit.id}`}>
                          <button
                            onMouseEnter={() => setActiveIndex(i)}
                            onClick={() => pickHit(hit)}
                            className={clsx(
                              "w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                              i === activeIndex ? "bg-zinc-100 dark:bg-white/5" : "hover:bg-zinc-50 dark:hover:bg-white/[0.03]",
                            )}
                          >
                            <span className="mt-0.5 shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-500 dark:text-zinc-300">
                              {hit.type === "conversation" ? <Bot size={15} /> : <FileText size={15} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm">
                                  <HighlightedParts
                                    parts={highlightTitle(hit.title, query)}
                                    className="font-semibold text-zinc-800 dark:text-zinc-100"
                                    matchedClassName="font-bold text-zinc-950 dark:text-white"
                                  />
                                </span>
                                {hit.date && (
                                  <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                                    {formatHitDate(hit.date, language)}
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs leading-relaxed">
                                {hit.matchReason === "semantic" && (
                                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-zinc-100 dark:bg-white/10 px-1 py-px text-[10px] text-zinc-400 dark:text-zinc-500">
                                    <Sparkles size={9} />
                                    {t("search.semantic")}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1 truncate">
                                  <HighlightedParts
                                    parts={hit.snippetParts}
                                    className="text-zinc-400 dark:text-zinc-500"
                                    matchedClassName="font-semibold text-zinc-700 dark:text-zinc-200"
                                  />
                                </span>
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
