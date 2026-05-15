import React, { useState, useEffect, useRef, useMemo } from "react";
import { Message } from "../data";
import clsx from "clsx";

interface RightNavProps {
  messages: Message[];
  scrollContainer: React.RefObject<HTMLDivElement | null>;
}

export function RightNav({ messages, scrollContainer }: RightNavProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);

  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tooltipData, setTooltipData] = useState<{ id: string, top: number, content: string } | null>(null);

  const userMessages = useMemo(() => messages.filter((m) => m.role === "user"), [messages]);
  const hasScrollbar = userMessages.length > 9;

  // Track main content scroll to update activeMsgId
  useEffect(() => {
    const container = scrollContainer.current;
    if (!container) return;

    const onScroll = () => {
      if (isScrollingRef.current) return;

      // Find the last user message whose top is above 50% of the viewport.
      const THRESHOLD = window.innerHeight * 0.5;
      let found: string | null = null;

      for (const msg of userMessages) {
        const el = document.getElementById(`msg-${msg.id}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top < THRESHOLD) {
            found = msg.id;
          } else {
            break;
          }
        }
      }

      // Fallback: when scrolled to very top before first message passes threshold
      if (found === null && userMessages.length > 0) {
        found = userMessages[0].id;
      }

      if (found !== null) setActiveMsgId(found);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 100);
    return () => container.removeEventListener('scroll', onScroll);
  }, [userMessages, scrollContainer]);

  const isHoveredRef = useRef(isHovered);
  isHoveredRef.current = isHovered;

  // Track activeMsgId to intelligently scroll the right nav minimap
  useEffect(() => {
    // Only auto-scroll the minimap when NOT actively hovering/manual-scrolling it
    if (!isHoveredRef.current && navScrollRef.current && activeMsgId) {
      const el = document.getElementById(`nav-msg-${activeMsgId}`);
      if (el) {
        const containerHeight = navScrollRef.current.clientHeight;
        const elOffset = el.offsetTop;
        const elHeight = el.clientHeight;
        const targetScroll = elOffset - (containerHeight / 2) + (elHeight / 2);
        
        navScrollRef.current.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    }
  }, [activeMsgId]);

  if (userMessages.length === 0) return null;

  const scrollToMessage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMsgId(id);
    
    // Ignore updates during smooth scroll
    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isScrollingRef.current = false;
    }, 800);

    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleMouseEnter = (msg: Message) => {
    setHoveredMsgId(msg.id);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    
    tooltipTimeoutRef.current = setTimeout(() => {
      const el = document.getElementById(`nav-msg-${msg.id}`);
      const container = navScrollRef.current;
      if (el && container) {
        const topPos = el.offsetTop - container.scrollTop + (el.offsetHeight / 2);
        setTooltipData({ id: msg.id, top: topPos, content: msg.content });
      }
    }, 2000);
  };

  const handleMouseLeave = () => {
    setHoveredMsgId(null);
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setTooltipData(null);
  };

  return (
    <div 
      className="absolute right-4 top-1/2 -translate-y-1/2 z-40 pointer-events-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { 
        setIsHovered(false); 
        setHoveredMsgId(null); 
        setTooltipData(null);
        if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      }}
    >
      <div 
        ref={navScrollRef}
        onScroll={() => setTooltipData(null)}
        className={clsx(
          "relative flex flex-col box-border max-h-[300px]",
          isHovered 
            ? "w-[260px] bg-white dark:bg-[#1A1A1A] rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)] border border-zinc-100 dark:border-white/10 opacity-100 py-[15px] pl-[24px] pr-[10px] overflow-y-auto rightnav-scrollbar" 
            : "w-[53px] bg-transparent border border-transparent opacity-80 py-[15px] pr-[19px] overflow-hidden"
        )}
        style={{ 
          scrollbarGutter: isHovered ? 'stable' : 'auto',
          maskImage: (!isHovered && hasScrollbar)
            ? 'linear-gradient(to bottom, transparent, black 15px, black calc(100% - 15px), transparent)'
            : 'none',
          WebkitMaskImage: (!isHovered && hasScrollbar)
            ? 'linear-gradient(to bottom, transparent, black 15px, black calc(100% - 15px), transparent)'
            : 'none'
        }}
      >
        {userMessages.map((msg) => {
          const isActive = msg.id === activeMsgId;
          const isMsgHovered = msg.id === hoveredMsgId;
          
          return (
             <div
              id={`nav-msg-${msg.id}`}
              key={msg.id}
              className="flex h-[30px] shrink-0 items-center justify-end group cursor-pointer w-full pr-1"
              onMouseEnter={() => handleMouseEnter(msg)}
              onMouseLeave={handleMouseLeave}
              onClick={(e) => {
                 scrollToMessage(msg.id, e);
                 setTooltipData(null);
              }}
            >
              {isHovered && (
                <div 
                  className={clsx(
                    "flex-1 truncate text-xs text-right pr-2 transition-colors font-medium whitespace-nowrap",
                    isActive 
                      ? "text-orange-500 dark:text-yellow-400 font-semibold" 
                      : (isMsgHovered 
                          ? "text-zinc-900 dark:text-zinc-100 font-semibold" 
                          : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300")
                  )}
                >
                  {msg.content}
                </div>
              )}
              
              <div className="shrink-0 w-8 flex justify-end items-center">
                <div 
                  className={clsx(
                    "rounded-full transition-all duration-300",
                    isActive 
                      ? "bg-orange-500 dark:bg-yellow-400 h-[3px] w-[14px]" 
                      : (isMsgHovered 
                          ? "bg-zinc-800 dark:bg-zinc-200 h-[3px] w-[14px]" 
                          : "bg-zinc-300 dark:bg-zinc-600 h-[2px] w-[10px]")
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip Popup */}
      {tooltipData && isHovered && (
        <div 
          className="absolute right-[100%] mr-4 w-[240px] bg-zinc-900 dark:bg-[#2A2A2A] text-zinc-100 p-3 rounded-lg shadow-xl z-50 text-xs leading-relaxed pointer-events-none before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:-right-1 before:border-y-4 before:border-y-transparent before:border-l-4 before:border-l-zinc-900 dark:before:border-l-[#2A2A2A] animate-in fade-in slide-in-from-right-2 duration-200"
          style={{ top: tooltipData.top, transform: 'translateY(-50%)' }}
        >
          <div className="line-clamp-5 break-words whitespace-pre-wrap font-sans text-left">
            {tooltipData.content}
          </div>
        </div>
      )}
    </div>
  );
}
