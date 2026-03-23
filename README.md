基于飞书和codex app server 做的桥.

1. 安装依赖
     pnpm install
2. 确保本机安装并登录 codex CLI（App Server 由 codex app-server 启动）。
     (https://developers.openai.com/codex/app-server))
3. 设置环境变量
     FEISHU_APP_ID
     FEISHU_APP_SECRET
     可选：CODEX_MODEL、CODEX_CWD、STREAM_EVERY_MS、CODEX_BIN
4. 启动
     node feishu-codex-appserver-min.mjs

# FEISHU_APP_ID 和 FEISHU_APP_SECRET的获取方法
1. 打开 open.feishu.cn
2. 开发者后台->创建企业自建应用
3. 名称和描述的都填 "codex",选择背景颜色和logo
4. 点击点击机器人
5. 点击事件与回调 订阅方式,使用长连接 添加事件 receive_v1,勾选接收消息
6. 权限配置

```json
{
  "scopes": {
    "tenant": [
      "aily:file:read",
      "aily:file:write",
      "application:application.app_message_stats.overview:readonly",
      "application:application:self_manage",
      "application:bot.menu:write",
      "cardkit:card:write",
      "contact:user.employee_id:readonly",
      "corehr:file:download",
      "docs:document.content:read",
      "event:ip_list",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.members:bot_access",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource",
      "sheets:spreadsheet",
      "wiki:wiki:readonly"
    ],
    "user": [
      "aily:file:read",
      "aily:file:write",
      "im:chat.access_event.bot_p2p_chat:read"
    ]
  }
}
```
7. 点击创建版本 确认发布
8. 点击凭证与基础信息,保存 App ID 和 App Secret
9. 在飞书中搜索你的机器人的名字