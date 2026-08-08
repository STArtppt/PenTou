/**
 * agent-tools.ts — 手写的 agent 工具目录（spec skill-runtime「`/api/tools` 手写工具目录」）。
 *
 * 这是内部 runner 与外部 agent（含 MCP 消费方）的**共享边界**：经 `GET /api/tools` 暴露。
 * 刻意**不从 `/api/*` 派生** —— 既有 40+ 端点是 CRUD 形状且无 schema，直接暴露
 * （尤其整表覆写的 `POST /api/document-folders`）等于邀请事故。这里按**任务意图**定义少而精的一组，
 * 每个工具声明自己内部落到哪些既有端点（`implementation`），差异只在于谁调用 LLM。
 *
 * 新增工具时：先问「这是一个用户会说出口的任务吗」，而不是「有没有对应的端点」。
 */

export interface AgentToolSpec {
  name: string;
  /** 面向模型的用途描述：说清楚「什么时候该用它」，而不只是它做什么。 */
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  /** 内部落到的既有 `/api/*` 端点，供外部消费方理解边界；声明用，不参与派发。 */
  implementation: { method: string; path: string }[];
  /** 是否改动数据。写工具在执行前必须过 agent-write-policy 的权限校验。 */
  mutates: boolean;
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    name: "read_current_view",
    description:
      "读取用户当前正在看的文档或会话的完整正文。上下文头只给了标题与大纲，需要正文才能回答（总结、翻译、改写、引用原文）时调用。可用 section 只取某一节，返回该节完整文本而非截断结果。",
    parameters: {
      type: "object",
      properties: {
        section: str("只取某一节：填该节的 H1/H2 标题原文。省略则取全文。"),
      },
      additionalProperties: false,
    },
    implementation: [
      { method: "GET", path: "/api/documents/:id" },
      { method: "GET", path: "/api/conversations/:id" },
    ],
    mutates: false,
  },
  {
    name: "search_corpus",
    description:
      "在用户全部会话与文档中做语义检索，回答「我以前聊过/写过什么」这类问题，或为主题汇总收集素材。不是用来列目录的——那用 list_documents。",
    parameters: {
      type: "object",
      properties: {
        query: str("自然语言查询。"),
        limit: int("返回条数上限，默认 6。"),
      },
      required: ["query"],
      additionalProperties: false,
    },
    implementation: [{ method: "GET", path: "/api/search" }],
    mutates: false,
  },
  {
    name: "list_documents",
    description:
      "列出文档的元数据（标题、归属项目与文件夹、更新时间、是否 AI 生成），不含正文。整理目录、判断哪些文档还没分类时用它。",
    parameters: {
      type: "object",
      properties: {
        projectId: str("只列某个项目下的文档；填 dp_default 表示默认目录。省略则列全部。"),
        unfiledOnly: { type: "boolean", description: "只列尚未归入任何文件夹的文档。" },
      },
      additionalProperties: false,
    },
    implementation: [{ method: "GET", path: "/api/documents?fields=meta" }],
    mutates: false,
  },
  {
    name: "read_document",
    description: "按 id 读取一篇文档的完整正文。已知目标文档、且需要其内容时使用。",
    parameters: {
      type: "object",
      properties: { docId: str("文档 id，形如 doc_xxx。") },
      required: ["docId"],
      additionalProperties: false,
    },
    implementation: [{ method: "GET", path: "/api/documents/:id" }],
    mutates: false,
  },
  {
    name: "list_folders",
    description:
      "列出文档项目与其下的文件夹（含每个项目的 AI 空间）。提议归类前必须先看现有目录结构，避免造出重复文件夹。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    implementation: [
      { method: "GET", path: "/api/document-projects" },
      { method: "GET", path: "/api/document-folders" },
    ],
    mutates: false,
  },
  {
    name: "create_folder",
    description:
      "在某个项目下新建一个文档文件夹。只增不删——已有文件夹的删除只能作为计划条目提议，不能由工具执行。",
    parameters: {
      type: "object",
      properties: {
        name: str("文件夹名。"),
        projectId: str("所属项目 id；省略或填 dp_default 表示默认目录。"),
      },
      required: ["name"],
      additionalProperties: false,
    },
    implementation: [{ method: "POST", path: "/api/document-folders" }],
    mutates: true,
  },
  {
    name: "assign_folder",
    description:
      "把一篇文档归入某个文件夹（或移出文件夹）。只改归属元数据，绝不触碰正文，因此对用户手写/导入的文档也允许。",
    parameters: {
      type: "object",
      properties: {
        docId: str("文档 id。"),
        folderId: str("目标文件夹 id；填空字符串表示移出文件夹。"),
      },
      required: ["docId", "folderId"],
      additionalProperties: false,
    },
    implementation: [{ method: "PUT", path: "/api/documents/:id" }],
    mutates: true,
  },
  {
    name: "write_workspace_doc",
    description:
      "在「AI 空间」里新建一篇文档，用于放 AI 的自主产物（主题汇总等）。用户点名要的产物（会话转文档、重写结果）不走这里——那些应落在用户自己的项目里。",
    parameters: {
      type: "object",
      properties: {
        title: str("文档标题。"),
        body: str("Markdown 正文。"),
        projectId: str("目标项目 id；决定落进哪个项目的 AI 空间。省略则落默认目录。"),
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    implementation: [{ method: "POST", path: "/api/documents" }],
    mutates: true,
  },
  {
    name: "propose_folder_plan",
    description:
      "把一组归类提议写成 AI 空间里的行动计划文档，每条前挂 `- [ ]` 待用户勾选批准。批量且改动既有数据的操作必须先走这里，不能直接执行。发现孤儿或重名文件夹时在 notes 里如实报告，不要自行清理。",
    parameters: {
      type: "object",
      properties: {
        projectId: str("计划所针对的项目 id。"),
        items: {
          type: "array",
          description: "归类提议条目。",
          items: {
            type: "object",
            properties: {
              docId: str("待归类的文档 id。"),
              folderName: str("目标文件夹名；不存在时执行阶段会先新建。"),
              reason: str("一句话说明为什么这么归。"),
            },
            required: ["docId", "folderName"],
          },
        },
        notes: {
          type: "array",
          description: "如实报告但不处置的数据异常（孤儿文件夹、重名文件夹等）。",
          items: { type: "string" },
        },
      },
      required: ["projectId", "items"],
      additionalProperties: false,
    },
    implementation: [{ method: "POST", path: "/api/documents" }],
    mutates: true,
  },
  {
    name: "read_memory",
    description:
      "读取记忆文档：全局记忆（用户偏好、跨项目事实）或某个项目的记忆。回答涉及「你还记得吗」「按我一贯的习惯」时先读它。",
    parameters: {
      type: "object",
      properties: {
        projectId: str("读某项目的记忆；省略则读默认目录下的全局记忆。"),
      },
      additionalProperties: false,
    },
    implementation: [{ method: "GET", path: "/api/documents/:id" }],
    mutates: false,
  },
  {
    name: "write_memory",
    description:
      "更新记忆文档。只记会长期成立的事实与偏好，不记本轮对话的细节。写入落为新版本，用户可回滚也可直接编辑。",
    parameters: {
      type: "object",
      properties: {
        body: str("记忆文档的完整 Markdown 正文（整篇替换，不是追加片段）。"),
        projectId: str("写某项目的记忆；省略则写全局记忆。"),
      },
      required: ["body"],
      additionalProperties: false,
    },
    implementation: [{ method: "POST", path: "/api/documents/:id/commit-version" }],
    mutates: true,
  },
];

/** 工具目录的 OpenAI `tools` 形状（客户端声明给模型时用）。 */
export function toolsForLLM(specs: AgentToolSpec[] = AGENT_TOOLS) {
  return specs.map((spec) => ({
    type: "function" as const,
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  }));
}

export function findAgentTool(name: string): AgentToolSpec | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}
