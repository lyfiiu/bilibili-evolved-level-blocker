# Bilibili-Evolved 等级屏蔽器 (`levelBlocker`)

为 [Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) 开发的自定义组件，支持按 B 站账号等级（`Lv.0` ~ `Lv.6`）自动屏蔽低等级 UP 主发布的视频/动态与评论区评论及楼中楼回复。

## 文件说明

- **可直接安装的单文件版本**：[`dist/level-blocker.js`](./dist/level-blocker.js)
- **Bilibili-Evolved 仓库标准源码结构**：[`registry/lib/components/utils/level-blocker/`](./registry/lib/components/utils/level-blocker/)
  - `index.ts`：组件元数据注册、热重载/卸载生命周期与样式注入
  - `options.ts`：组件配置项（UP 主最低等级、评论最低等级、屏蔽方式、白名单、缓存天数等）
  - `level-service.ts`：用户等级缓存与查询服务（被动采集 + 本地持久化缓存 + 批量名片接口 + 限流退避）
  - `comment-blocker.ts`：评论区屏蔽器（兼容 Shadow DOM V3、Vue 3 V2、旧版 DOM V1，支持主评论与楼中楼）
  - `video-blocker.ts`：全站视频/动态卡片屏蔽器（首页、分区、热门/排行、搜索、播放页推荐、动态页、空间页与 Bilibili-Evolved 自带卡片）
  - `stats-badge.ts`：左下角可选屏蔽计数角标，支持一键临时全部显示/恢复屏蔽
  - `level-blocker.scss` / `level-blocker-shadow.scss`：主文档与 Shadow DOM 样式（支持深色模式变量）
  - `index.md`：组件文档

## 直接安装使用（推荐）

无需本地编译环境，直接在浏览器中导入 [`dist/level-blocker.js`](./dist/level-blocker.js) 即可使用：

1. 在 Bilibili 页面打开 Bilibili-Evolved 面板，进入 **功能库**（也可通过全局搜索栏输入「切换功能库」打开）。
2. 点击顶部工具栏的 **本地浏览** 按钮。
3. 选择本目录下的 `dist/level-blocker.js` 文件完成安装。
4. 刷新页面后，在 Bilibili-Evolved **设置 -> 工具 / 动态** 中找到 **等级屏蔽器**，按需调整「最低 UP 主等级」和「最低评论用户等级」（支持实时生效，无需刷新）。

## 源码集成到 Bilibili-Evolved 仓库构建

如果你在本地维护 `Bilibili-Evolved` 源码仓库：

1. 将 `registry/lib/components/utils/level-blocker/` 目录复制到 `Bilibili-Evolved/registry/lib/components/utils/level-blocker/`。
2. 在仓库根目录执行类型检查、代码规范检查与组件构建：
   ```sh
   pnpm run type
   pnpm run lint-check
   pnpm tsx dev-tools/dev-server/command.ts build component utils/level-blocker
   ```
