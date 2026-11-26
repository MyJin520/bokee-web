/** 通用 API 响应结构 */
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  msg: string
}

/** 分页数据结构 */
export interface PageData<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 文章列表项 */
export interface ArticleListItem {
  id: number
  title: string
  summary: string
  cover: string
  viewCount: number
  favoriteCount: number
  likeCount: number
  isTop: boolean
  userId: number
  createdAt: string
}

/** 文章作者公开信息 */
export interface AuthorInfo {
  id: number
  name: string
  avatar: string
}

/** 文章详情 */
export interface ArticleInfo {
  id: number
  title: string
  content: string
  summary: string
  cover: string
  viewCount: number
  favoriteCount: number
  likeCount: number
  isTop: boolean
  userId: number
  author: AuthorInfo
  createdAt: string
  updatedAt: string
}

/** 登录响应 */
export interface JwtResp {
  token: string
  name: string
  avatar: string
  email: string
  phone: string
}

/** 用户信息 */
export interface UserInfo {
  id: number
  name: string
  phone: string
  email: string
  status: string
  avatar: string
  followersCount: number
  roles: UserRole[]
  createdAt: string
  updatedAt: string
}

export interface UserRole {
  id: number
  name: string
  code: number
}

/** 用户简要信息（find_users 返回：id / 昵称 / 头像 / 粉丝数 / 加入时间） */
export interface UserBrief {
  id: number
  name: string
  avatar: string
  followersCount: number
  createdAt: string
}

/** 文件上传记录 */
export interface UploadedFile {
  id: number
  url: string
  ext: string
  size: number
  originalName: string
  hash: string
  createdAt: string
  updatedAt: string
}

/** 用户操作类型：点赞 / 收藏 / 关注 */
export type ActionType = 'like' | 'bookmark' | 'follow'

/** 用户操作目标类型：文章 / 作者 */
export type TargetType = 'article' | 'author'

/** 用户操作列表项（扁平结构，按 targetType 解释 targetTitle：文章标题 / 作者名称） */
export interface UserActionListItem {
  actionId: number
  targetType: TargetType
  targetId: number
  targetTitle: string
  targetAvatar: string
}

/** ============ 用户反馈 ============ */

/** 反馈类型：Bug / 优化建议 / 新功能建议 / 其他 */
export type FeedbackType = 'bug' | 'optimize' | 'feature' | 'other'

/** 反馈处理状态：待处理 / 处理中 / 已解决 / 不处理 */
export type FeedbackStatus = 'pending' | 'processing' | 'resolved' | 'ignored'

/** 反馈提交者信息 */
export interface FeedbackUser {
  id: number
  name: string
  avatar: string
}

/** 反馈列表项 */
export interface FeedbackListItem {
  id: number
  type: FeedbackType
  title: string
  content: string
  /** 截图地址，取自文件上传接口返回的 url */
  images: string[] | null
  /** 仅超管或提交者本人可见，其余情况为空串 */
  pageUrl: string
  /** 仅超管或提交者本人可见，其余情况为空串 */
  contact: string
  status: FeedbackStatus
  /** 官方最终答复（管理员维护），与讨论区回复是两套内容 */
  reply: string
  repliedAt: string | null
  /** 讨论区回复条数 */
  replyCount: number
  userId: number
  user: FeedbackUser | null
  createdAt: string
}

/** 反馈讨论区的一条回复 */
export interface FeedbackReply {
  id: number
  feedbackId: number
  /** 父回复 ID，0 表示直接回复反馈 */
  parentId: number
  content: string
  /** 写入时是否为超管回复，用于展示「官方」标识 */
  isAdmin: boolean
  user: FeedbackUser | null
  createdAt: string
}

/** 反馈统计项（key 为类型或状态枚举值） */
export interface FeedbackCountItem {
  key: string
  count: number
}

/** 反馈统计（仅超管） */
export interface FeedbackSummary {
  total: number
  pending: number
  byType: FeedbackCountItem[]
  byStatus: FeedbackCountItem[]
}
