# NotebookPoint

把你在微信里转发的文章、链接、资料,自动同步成 **Obsidian** 笔记。

本仓库是 NotebookPoint 的 **Obsidian 插件(客户端,开源)**。它只做一件事:凭你的卡密,从 NotebookPoint 服务拉取你转发的内容,写成 Markdown 笔记到你的 vault。**不含任何密钥**;内容的接收 / 解析 / 存储由托管服务完成。

## 怎么用
1. 按[图文教程](https://api.monoi.cn/nbp/guide)安装插件
2. 在插件设置里填入你的**卡密**
3. 在微信里加「obsidian」客服,把卡密发给它激活
4. 之后你转发的文章 / 链接,会自动同步进 Obsidian 🎉

## 构建
```bash
npm install
npm run build   # 产物 main.js
```

## License
MIT
