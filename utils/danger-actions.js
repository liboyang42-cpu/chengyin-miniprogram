/**
 * 危险动作确认文案 · 单一真源。
 *
 * 为什么集中:确认文案散在 30 多个页面里各写各的,结果是同一类动作(删除/退出/移除)
 * 有的写「确定要删除这个地址吗?」有的什么都不写,连带影响一律不说。集中一处后,
 * 门禁(scripts/danger-confirm-gate.js)才能逐条校验「不可逆的有没有写明不可撤销」。
 *
 * 字段:
 *   irreversible  true = 不可逆。门禁强制 consequences 里必须有一条含「此操作不可撤销」。
 *                 false = 可逆(重新申请/重新上架/重新登录即可),只要求有确认,不强制该文案。
 *   title         弹窗标题,问句。`{name}` 会被 open() 的 params.name 替换。
 *   content       标题下的一句话正文(可选)。参考 Revolut 118「This action is irreversible and
 *                 will cancel all scheduled payments」——把最重的连带影响放这里。
 *   consequences  后果清单,[{ icon, text }]。照 Revolut 185 / Threads 78:三条以内,
 *                 每条一个 icon + 一句人话,讲「会发生什么」而不是「你确定吗」。
 *   confirmText   危险按钮文案,用动词(「解散俱乐部」),不用「确定」。
 *   alt           更轻的替代方案,{ text, hint }。照 Revolut 185 的 Freeze card temporarily:
 *                 能不删就别删的,一定要在同一屏给出退路。没有真替代就别硬造,留空。
 *   done          执行成功后的结果确认卡,{ title, text }。三段式的第三段。
 *                 title/text 与上面几个字段一样支持 `{name}` 占位(2026-09-24 CU-C-71:退出俱乐部的
 *                 回执要按 club.join_policy 分流,回执文案也是策略相关的)。
 *
 * icon 取值必须是 components/cy/icon/icons.wxss 里已有的名字。
 */

const DANGER_ACTIONS = {
  // ===== 俱乐部 =====
  'club.dissolve': {
    irreversible: true,
    title: '解散「{name}」?',
    content: '解散后俱乐部不再对外展示,内容与群聊入口一并消失。',
    consequences: [
      { icon: 'mtab-customers', text: '全部成员会被移出俱乐部,同时失去群聊入口' },
      { icon: 'calendar', text: '俱乐部名下的活动与会员权益一并下架;已报名的不会自动取消,也不会自动退款' },
      { icon: 'warning', text: '此操作不可撤销,解散后无法恢复这个俱乐部' },
    ],
    confirmText: '解散俱乐部',
    alt: { text: '改为转让主理人', hint: '把俱乐部交给别人打理,成员和内容都留着' },
    done: { title: '俱乐部已解散', text: '成员已收到通知。未结事项仍需在合作中心逐笔处理。' },
  },
  'club.quit': {
    irreversible: true,
    title: '退出「{name}」?',
    // CU-C-71:重入代价不是全团统一的 —— 公开团(policy≠1)退出后点一下就回来,没有审批可等。
    // 这句只留占位符,由 onQuit 按 club.joinPolicy 填;写死「要重新申请」会误导公开团成员。
    content: '重新进来时，{rejoin}。',
    consequences: [
      { icon: 'logout', text: '你会被移出团群,看不到成员专属内容' },
      { icon: 'coupon', text: '会员专属活动的报名资格立即失效,已付款项不随退出自动退回' },
      { icon: 'warning', text: '此操作不可撤销,当前的成员身份与加入时间不会保留' },
    ],
    confirmText: '退出俱乐部',
    alt: { text: '只关掉群聊提醒', hint: '留在俱乐部,但不再收到群消息推送' },
    done: { title: '已退出俱乐部', text: '想回来的话，{rejoinHint}。' },
  },
  'club.post.delete': {
    irreversible: true,
    // CU-C-107:「删除这条动态?」没有宾语 —— 列表里多条动态时,最后这一步核对不了目标。
    // 占位符由调用方填正文前段(见 postExcerpt)。
    title: '删除这条动态「{name}」?',
    consequences: [
      { icon: 'mtab-customers', text: '这条动态下的全部评论和点赞会一起删掉' },
      { icon: 'warning', text: '此操作不可撤销,动态内容无法找回' },
    ],
    confirmText: '删除动态',
    alt: null,
    done: { title: '已删除', text: '你的推文已被删除' },   // 稿 txQoyVyK 356:4992
  },
  'club.comment.delete': {
    irreversible: true,
    title: '删除这条评论?',
    consequences: [
      { icon: 'warning', text: '此操作不可撤销,评论内容无法找回' },
    ],
    confirmText: '删除评论',
    alt: null,
    done: { title: '评论已删除', text: '' },
  },
  'club.member.remove': {
    irreversible: true,
    title: '把「{name}」移出俱乐部?',
    content: '对方会收到站内通知。',
    consequences: [
      { icon: 'logout', text: '对方立即失去俱乐部与群聊入口,以及成员专属内容' },
      { icon: 'coupon', text: '对方已报名的会员活动不会自动取消,也不会自动退款' },
      { icon: 'warning', text: '此操作不可撤销,成员身份与加入时间不会保留;对方可以重新申请' },
    ],
    confirmText: '移出成员',
    alt: null,
    done: { title: '成员已移出', text: '对方已收到站内通知。' },
  },
  // ===== 商家售后 =====
  'merchant.aftercare.reject': {
    // 可逆:平台审核结束前商家仍可再提交「同意」,最新一条意见为准;不动款项。
    irreversible: false,
    title: '确认不同意这笔退款申请?',
    consequences: [
      { icon: 'info', text: '这是商家意见，不会直接驳回申请，最终结果以平台审核为准' },
      { icon: 'clock', text: '平台审核结束前，你仍可以再提交「同意」改变意见' },
    ],
    confirmText: '确认不同意',
    alt: { text: '再想想', hint: '已写的原因会保留，稍后再提交' },
    done: { title: '已提交不同意意见', text: '' },
  },

  'club.joinRequest.reject': {
    // 可逆:拒绝后对方可以重新提交申请。
    irreversible: false,
    title: '拒绝「{name}」的入会申请?',
    consequences: [
      { icon: 'bell', text: '对方会看到申请未通过,但看不到具体原因' },
      { icon: 'clock', text: '对方之后仍可以重新提交申请' },
    ],
    confirmText: '拒绝申请',
    alt: { text: '先放着不处理', hint: '申请会留在列表里,想清楚再决定' },
    done: { title: '已拒绝申请', text: '' },
  },

  // ===== 小队 =====
  'team.disband': {
    irreversible: true,
    title: '解散这支队伍?',
    content: '队伍解散后群聊关闭,队员各自回到未组队状态。',
    consequences: [
      { icon: 'mtab-customers', text: '全部队员会被移出队伍,队伍群聊同时关闭' },
      { icon: 'coupon', text: '不会触发任何退款;队员各自的票仍然有效,需要自己去核销' },
      { icon: 'warning', text: '此操作不可撤销,队伍与聊天记录无法恢复' },
    ],
    confirmText: '解散队伍',
    alt: { text: '改为退出队伍', hint: '队长会移交给最早加入的队员,队伍留着' },
    done: { title: '队伍已解散', text: '队员已收到通知。' },
  },
  'team.kick': {
    irreversible: true,
    title: '把「{name}」移出队伍?',
    consequences: [
      { icon: 'bell', text: '对方会收到站内通知,并失去队伍群聊入口' },
      { icon: 'coupon', text: '移出不同步退票,对方的票仍然有效' },
      { icon: 'warning', text: '此操作不可撤销;被移出的人不能用邀请码回来,也不能再次申请加入' },
    ],
    confirmText: '移出队员',
    alt: null,
    done: { title: '队员已移出', text: '对方已收到站内通知。' },
  },
  'team.quit': {
    irreversible: true,
    title: '退出这支队伍?',
    content: '退队不会同步退票,你的票仍然有效。',
    consequences: [
      { icon: 'logout', text: '你会失去队伍群聊入口' },
      { icon: 'mtab-customers', text: '你是队长的话,队长会移交给最早加入的队员;只剩你一人时队伍直接解散' },
      { icon: 'warning', text: '此操作不可撤销,需要重新被邀请才能回到这支队伍' },
    ],
    confirmText: '退出队伍',
    alt: null,
    done: { title: '已退出队伍', text: '你的票仍然有效,可以自己去核销。' },
  },

  // ===== 帖文草稿 =====
  // 草稿是「还没发出去的东西」,删掉就真没了(本地 storage,服务端没有副本)。
  // alt 为 null 不是偷懒:草稿本来就不对外可见,没有比「删」更轻的下架档可给。
  'post.draft.delete': {
    irreversible: true,
    title: '删除这条草稿?',
    content: '草稿只存在这台手机上,删掉不会同步到别处、也没有回收站。',
    consequences: [
      { icon: 'draft', text: '这条草稿里的文字会被删掉' },
      { icon: 'warning', text: '此操作不可撤销,草稿内容无法找回' },
    ],
    confirmText: '删除草稿',
    alt: null,
    done: { title: '草稿已删除', text: '' },
  },

  // ===== 个人 =====
  // 2026-09-15 R9-13:这份资料页已明确「用于报名联系和到场核验,不用于配送」,
  // 文案不能再用「地址」;同时要讲清删除不等同于取消已产生的报名。
  'address.delete': {
    irreversible: true,
    title: '删除这条参与人信息?',
    content: '姓名和手机号只用于报名联系与到场核验,删除只影响之后报名时选用。',
    consequences: [
      { icon: 'warning', text: '此操作不可撤销,删除后需要重新填写参与人资料' },
      { icon: 'calendar', text: '已经产生的报名不会因此取消,历史报名记录仍然有效' },
    ],
    confirmText: '删除参与人信息',
    alt: null,
    done: { title: '参与人信息已删除', text: '历史报名记录不受影响。' },
  },

  // ===== 商家 =====
  'perk.delete': {
    irreversible: true,
    title: '删除常备权益「{name}」?',
    content: '已经发出去的权益不受影响,只是之后不能再挂这一条。',
    consequences: [
      { icon: 'gift', text: '这条权益不会再出现在新的合作与装修里' },
      { icon: 'check', text: '玩家已经领到的同名权益仍然有效,不受影响' },
      { icon: 'warning', text: '此操作不可撤销,模板内容无法找回' },
    ],
    confirmText: '删除权益',
    alt: null,
    done: { title: '常备权益已删除', text: '' },
  },
  'merchant.chapterApplication.withdraw': {
    irreversible: true,
    title: '撤回这次申请?',
    content: '撤回后回到未申请状态,需要重新提交。',
    consequences: [
      { icon: 'check', text: '已填的点位内容会保留,重新提交时不用再填一遍' },
      { icon: 'clock', text: '当前这条申请作废,重新提交按新时间排队' },
      { icon: 'warning', text: '此操作不可撤销,撤回后这条申请无法恢复' },
    ],
    confirmText: '确认撤回',
    alt: null,
    done: { title: '申请已撤回', text: '需要时可以重新提交。' },
  },

  /* 稿 468:1126「章节控制 → 结束本章」。2026-09-10 用户定:只有发起人能点。
     ⚠️ 三条后果都要能兑现,别写成吓唬人的话:
        · 已售票不受影响 —— 端点只写章节的结束时刻,一条报名/订单都不碰;
        · 商家承接开关连带锁死 —— 后端对已结束的章节拒掉那条开关,不然「结束」会变成可来回拨;
        · 不可撤销 —— 时刻只在为空时写一次,再点原样拒掉,不覆盖。 */
  'topic.chapter.finish': {
    irreversible: true,
    title: '结束「{name}」?',
    content: '结束后这一章不再接受商家承接申请。',
    consequences: [
      { icon: 'coupon', text: '已售出的票不受影响,玩家照常到店、照常核销' },
      { icon: 'lock', text: '「开放报名」这一行随之锁死,不能再开;在途的商家申请不会自动通过' },
      { icon: 'warning', text: '此操作不可撤销,结束后无法重新开放这一章' },
    ],
    confirmText: '结束本章',
    alt: { text: '改为关闭开放报名', hint: '先停掉新的商家申请,这一章仍然可以再打开' },
    done: { title: '本章已结束', text: '已售出的票不受影响。' },
  },

  // ===== 权限(逻辑不在本次改动范围,只统一确认文案) =====
  'club.role.revoke': {
    irreversible: true,
    title: '撤销「{name}」?',
    content: '撤销后对方立即失去这个范围内的权限。',
    consequences: [
      { icon: 'lock', text: '对方立刻失去该范围内的全部管理动作,进行中的操作会被打断' },
      { icon: 'mtab-customers', text: '对方仍然是俱乐部成员,只是不再有这个角色' },
      { icon: 'warning', text: '此操作不可撤销;要恢复只能重新分配一次角色' },
    ],
    confirmText: '撤销角色',
    alt: null,
    done: { title: '角色已撤销', text: '' },
  },
  'merchant.operator.remove': {
    irreversible: true,
    title: '移除团队成员「{name}」?',
    content: '移除后对方的商家权限立即失效。',
    consequences: [
      { icon: 'lock', text: '对方立即失去这个店铺的全部经营权限' },
      { icon: 'finance', text: '已经产生的经营记录与流水保留,不会被删掉' },
      { icon: 'warning', text: '此操作不可撤销;要恢复只能重新邀请一次' },
    ],
    confirmText: '移除成员',
    alt: null,
    done: { title: '成员已移除', text: '对方的经营权限已失效。' },
  },
  'merchant.invite.revoke': {
    irreversible: true,
    title: '撤销这条邀请?',
    content: '撤销后已经发出的邀请链接立即失效。',
    consequences: [
      { icon: 'qr', text: '已经发出去的邀请链接立刻打不开' },
      { icon: 'warning', text: '此操作不可撤销;要重新邀请需要另发一条,凭证只显示一次' },
    ],
    confirmText: '撤销邀请',
    alt: null,
    done: { title: '邀请已撤销', text: '旧链接已失效。' },
  },
  'merchant.review.reply.delete': {
    irreversible: true,
    title: '删除这条公开回复?',
    content: '只是写错了话,改成新的比删掉更轻。',
    consequences: [
      { icon: 'comment', text: '玩家和其他访客将看不到你写的这段公开回复' },
      { icon: 'clock', text: '这条评价回到「待回复」,你可以重新写一条' },
      { icon: 'warning', text: '此操作不可撤销,删掉的回复内容无法找回' },
    ],
    confirmText: '删除回复',
    alt: { text: '改为修改回复', hint: '保留这条回复的位置,改成你真正想说的内容' },
    done: { title: '回复已删除', text: '这条评价已回到待回复,可以重新回复。' },
  },
  // ===== 创作(我的项目)=====
  // 这三条都有现成的「下架」开关(toggleStatus / tplToggle),所以替代方案不是编出来的,
  // 是把页面上本来就有的那个按钮摆到确认弹窗里 —— 想让它不出现在外面,下架就够了。
  'route.delete': {
    irreversible: true,
    title: '删除路线「{name}」?',
    content: '只是想让它不再出现在列表里的话,下架就够了。',
    consequences: [
      { icon: 'route', text: '路线下的节点、玩法配置和已排的场次会一起删掉' },
      { icon: 'mtab-customers', text: '已经报名的玩家不会自动退款,需要你另行处理' },
      { icon: 'warning', text: '此操作不可撤销,路线内容无法找回' },
    ],
    confirmText: '删除路线',
    alt: { text: '改为下架路线', hint: '玩家看不到,内容和数据都留着,随时可以重新上架' },
    done: { title: '路线已删除', text: '' },
  },
  'activity.delete': {
    irreversible: true,
    title: '删除场次「{name}」?',
    content: '只是想停止售卖的话,下架就够了。',
    consequences: [
      { icon: 'calendar', text: '这一场的时间、名额和报名记录会一起删掉' },
      { icon: 'mtab-customers', text: '已经报名的玩家不会自动退款,需要你另行处理' },
      { icon: 'warning', text: '此操作不可撤销,场次内容无法找回' },
    ],
    confirmText: '删除场次',
    alt: { text: '改为下架场次', hint: '停止新报名,已有报名和数据都留着' },
    done: { title: '场次已删除', text: '' },
  },
  'template.delete': {
    irreversible: true,
    title: '删除节点玩法「{name}」?',
    content: '只是不想让别人再用的话,从玩法库下架就够了。',
    consequences: [
      { icon: 'play', text: '已经引用了这个玩法的节点不受影响,继续按原配置跑' },
      { icon: 'warning', text: '此操作不可撤销,玩法配置无法找回' },
    ],
    confirmText: '删除玩法',
    alt: { text: '改为从玩法库下架', hint: '别人搜不到,你自己的节点照常用' },
    done: { title: '节点玩法已删除', text: '' },
  },
  // ===== 2026-09-06 三端审核:原生 showModal 全删后,这批「已登记危险写」按铁律切三段式 =====
  'activity.cancel-refund': {
    irreversible: true,
    title: '取消这场活动并退款?',
    content: '将给 {count} 位已付款玩家全额退款,不可撤销。活动同时下架。',
    consequences: [
      { icon: 'finance', text: '已报名未核销的玩家全额退款,款项原路退回' },
      { icon: 'calendar', text: '活动下架,玩家不能再报名或进入' },
      { icon: 'warning', text: '此操作不可撤销,取消后无法恢复这场活动' },
    ],
    confirmText: '取消并退款',
    alt: null,
    done: { title: '活动已取消', text: '已全额退款给所有已报名玩家。' },
  },
  'topic.cancel-refund': {
    irreversible: true,
    title: '取消「{name}」并退款?',
    content: '将给 {count} 位已付款玩家全额退款,不可撤销。主题同时停售,名下场次一并取消。',
    consequences: [
      { icon: 'finance', text: '已付款未核销的玩家全额退款,款项原路退回' },
      { icon: 'calendar', text: '主题停售,名下所有场次取消,玩家不能再报名或进入' },
      { icon: 'warning', text: '已核销的票不退;此操作不可撤销' },
    ],
    confirmText: '取消并退款',
    alt: null,
    done: { title: '主题已取消', text: '已全额退款给已付款玩家。' },
  },
  'club.enroll.refund': {
    irreversible: true,
    title: '取消「{name}」的报名?',
    content: '取消对方的报名资格，符合规则的退款按原支付记录处理。',
    consequences: [
      { icon: 'finance', text: '现金退款、积分返还以实际支付记录和查询结果为准' },
      { icon: 'mtab-customers', text: '对方从本团名册移出,群码失效' },
      { icon: 'warning', text: '此操作不可撤销,清退后需要对方重新报名' },
    ],
    confirmText: '退款并清退',
    alt: null,
    done: { title: '清退请求已受理', text: '请查看订单确认取消及退款进度。' },
  },
  'im.block': {
    irreversible: false,
    title: '拉黑对方?',
    content: '',
    consequences: [
      { icon: 'close', text: '不再收到对方的任何消息' },
      { icon: 'info', text: '对方不会收到拉黑提示;拉黑后暂不支持解除' },
    ],
    confirmText: '拉黑',
    alt: null,
    done: { title: '已拉黑', text: '你不会再收到对方消息。' },
  },
  'im.conversation.delete': {
    irreversible: true,
    title: '删除这条会话?',
    content: '只删除你这边的会话入口,对方的消息记录不受影响。',
    consequences: [
      { icon: 'trash', text: '会话从你的列表消失' },
      { icon: 'warning', text: '此操作不可撤销,删除后聊天记录不再显示' },
    ],
    confirmText: '删除会话',
    alt: null,
    done: { title: '会话已删除', text: '' },
  },
  'account.logout': {
    irreversible: false,
    title: '退出当前账号?',
    content: '',
    consequences: [
      { icon: 'logout', text: '本机登录态清除,下次进入需要重新登录' },
      { icon: 'info', text: '已购通行证、订单和券都保留在账号里,不会丢' },
    ],
    confirmText: '退出登录',
    alt: null,
    done: { title: '已退出', text: '' },
  },
  'account.deregister.cancel': {
    irreversible: false,
    title: '撤销注销申请?',
    content: '撤销后账号立即恢复正常使用。',
    consequences: [
      { icon: 'check', text: '账号恢复正常,登录与购买不受影响' },
      { icon: 'info', text: '之后需要注销可以再次申请' },
    ],
    confirmText: '撤销申请',
    alt: null,
    done: { title: '已撤销注销申请', text: '账号已恢复正常使用。' },
  },
  'order.cancel-refund': {
    irreversible: true,
    title: '取消报名?',
    content: '取消后报名资格失效，现金退款和积分返还按本单实际支付记录处理。{deadline}。',
    consequences: [
      { icon: 'finance', text: '本单如有现金退款或积分返还，进度以订单查询结果为准' },
      { icon: 'calendar', text: '名额释放,错过后需要重新报名' },
      { icon: 'warning', text: '此操作不可撤销，取消后这张票作废' },
    ],
    confirmText: '取消并退款',
    alt: null,
    done: { title: '取消请求已受理', text: '请查看订单确认取消及退款进度。' },
  },
  'order.cancel': {
    irreversible: true,
    title: '取消这个待支付订单?',
    content: '',
    consequences: [
      { icon: 'close', text: '订单关闭,不再保留名额' },
      { icon: 'warning', text: '此操作不可撤销,需要时请重新下单' },
    ],
    confirmText: '取消订单',
    alt: null,
    done: { title: '订单已取消', text: '' },
  },
  'waitlist.quit': {
    irreversible: false,
    title: '退出候补队列?',
    content: '',
    consequences: [
      { icon: 'calendar', text: '已保留的名额会立即让给下一位' },
      { icon: 'info', text: '之后还想来,可以重新排队,顺位从头算' },
    ],
    confirmText: '退出候补',
    alt: null,
    done: { title: '已退出候补', text: '' },
  },
  'roam.finish': {
    irreversible: true,
    title: '结束本次漫游?',
    content: '足迹和探店都会保存,结算后可领足迹卡。',
    consequences: [
      { icon: 'flag', text: '本次漫游立即结算,足迹与探店记录保留' },
      { icon: 'warning', text: '此操作不可撤销,结束后不能继续这一次漫游' },
    ],
    confirmText: '结束漫游',
    alt: null,
    done: { title: '漫游已结束', text: '结算完成后可在漫游记录里领足迹卡。' },
  },
  'membership.invoice.close': {
    irreversible: false,
    title: '结束这张待支付账单?',
    content: '会先向微信支付核对真实状态,再关单并读回终态。',
    consequences: [
      { icon: 'finance', text: '关单前不会允许换计划重复下单' },
      { icon: 'info', text: '关掉后可以重新选计划下单' },
    ],
    confirmText: '结束账单',
    alt: null,
    done: { title: '账单已关闭', text: '' },
  },
  'membership.cancel': {
    irreversible: false,
    title: '取消这段付费权益?',
    content: '取消会立即停止这段权益。',
    consequences: [
      { icon: 'coupon', text: '会员专属权益立即停止' },
      { icon: 'finance', text: '取消不等于退款,已付款项不会自动退回' },
    ],
    confirmText: '取消权益',
    alt: null,
    done: { title: '权益已取消', text: '' },
  },
  // ===== 漫游·附近的局(2026-09-06 从 wx.showModal 收编) =====
  'hangout.close': {
    irreversible: true,
    title: '关掉「{name}」?',
    content: '关局后群聊一起关闭,所有人都不能再发言。',
    consequences: [
      { icon: 'mtab-customers', text: '群里的人会看到这局已结束,地图上不再显示' },
      { icon: 'warning', text: '此操作不可撤销,想再玩只能重新开一局' },
    ],
    confirmText: '关局',
    alt: null,
    done: { title: '这局已关', text: '群聊已结束。' },
  },
  'hangout.leave': {
    irreversible: false,
    title: '退出「{name}」?',
    consequences: [
      { icon: 'logout', text: '群聊会从你的消息列表消失' },
      { icon: 'mtab-customers', text: '局还开着的话,随时可以再加入' },
    ],
    confirmText: '退出这局',
    alt: null,
    done: { title: '已退出', text: '' },
  },
  // ===== 商家优惠券(2026-09-17 用户拍板:可停发自己发的券) =====
  'merchant.coupon.stop': {
    irreversible: true,
    title: '停发「{name}」?',
    content: '停发后这张券不能再被领取、发放,已领到的券不受影响。',
    consequences: [
      { icon: 'coupon', text: '还没领的人再也领不到;已领到的券照常可用、可核销' },
      { icon: 'warning', text: '此操作不可撤销,停发后无法恢复继续发放' },
    ],
    confirmText: '停发该券',
    alt: null,
    done: { title: '已停发', text: '这张券不再新增发放,已领的照常可用。' },
  },
};

/**
 * 待删/待处理的正文摘出一段,给危险确认的 `{name}` 占位符用(CU-C-107)。
 * 单一真源:俱乐部动态与广场帖文同一份截断规则 —— 两处各写一个 slice 迟早会一个 12 字一个 20 字。
 * 纯图无正文时说「(仅图片动态)」,不留空占位。
 */
function postExcerpt(text, max) {
  const limit = max || 12;
  const flat = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
  if (!flat) return '(仅图片动态)';
  return flat.length > limit ? flat.slice(0, limit) + '…' : flat;
}

/** `{name}` 占位替换;params 缺字段时退回中性说法,不留裸占位。 */
function fillTemplate(text, params) {
  if (!text) return '';
  return String(text).replace(/\{(\w+)\}/g, function (whole, key) {
    const value = params && params[key];
    return (value === undefined || value === null || value === '') ? '这一项' : String(value);
  });
}

/** 取一个动作的完整文案;key 没登记时返回 null,由调用方决定报错还是降级。 */
function getDangerAction(key, params) {
  const raw = DANGER_ACTIONS[key];
  if (!raw) return null;
  return {
    key: key,
    irreversible: !!raw.irreversible,
    title: fillTemplate(raw.title, params),
    content: fillTemplate(raw.content, params),
    consequences: (raw.consequences || []).map(function (item) {
      return { icon: item.icon, text: fillTemplate(item.text, params) };
    }),
    confirmText: raw.confirmText || '确认',
    alt: raw.alt ? { text: raw.alt.text, hint: fillTemplate(raw.alt.hint, params) } : null,
    // CU-C-71:回执文案也要过模板 —— 退出俱乐部的 done.text 按 join_policy 分流。
    done: {
      title: fillTemplate((raw.done && raw.done.title) || '已完成', params),
      text: fillTemplate((raw.done && raw.done.text) || '', params),
    },
  };
}

module.exports = { DANGER_ACTIONS, getDangerAction, fillTemplate, postExcerpt };
