/**
 * 输入法（IME）组合态判定。
 *
 * 中文 / 日文 / 韩文输入法里，Enter 是「确认候选词」的键，和「提交表单 / 发消息」撞了。
 * 组合期间浏览器仍会派发 keydown，若不加判别，用户敲 Enter 选词就会被当成提交 ——
 * 典型现象：中文输入法下打英文单词，按回车想上屏字母，消息直接发出去了。
 *
 * 两条判据缺一不可：
 * - `isComposing`：标准属性，Chrome / Firefox / Edge 在组合期给 true；
 * - `keyCode === 229`：老规范的「IME 处理中」哨兵值，Safari/WebKit 与部分安卓输入法只给这个。
 *
 * 所有靠 Enter 触发动作的文本输入框，都必须先过这道闸（Escape 同理：组合期的 Esc 是取消候选，
 * 不该关弹窗）。
 */
type ComposingLike = {
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  isComposing?: boolean;
  keyCode?: number;
};

export function isImeComposing(e: ComposingLike): boolean {
  // 两层都查：React 合成事件透传 `keyCode` 但不透传 `isComposing`，后者只在 nativeEvent 上。
  const native = e.nativeEvent;
  return (
    e.isComposing === true ||
    e.keyCode === 229 ||
    native?.isComposing === true ||
    native?.keyCode === 229
  );
}
