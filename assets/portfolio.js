(() => {
  'use strict';

  const themeToggle = document.getElementById('theme-toggle');
  let storedTheme;
  try { storedTheme = localStorage.getItem('liao-wang-theme'); } catch (_) {}
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(value) {
    const theme = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    if (themeToggle) {
      themeToggle.textContent = theme === 'dark' ? '☀' : '☾';
      const label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
      themeToggle.setAttribute('aria-label', label);
      themeToggle.title = label;
    }
  }
  applyTheme(storedTheme || (prefersDark.matches ? 'dark' : 'light'));
  themeToggle?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('liao-wang-theme', next); } catch (_) {}
  });

  const demoSrc = document.body.dataset.demoSrc;
  if (!demoSrc) return;
  const element = (id) => document.getElementById(id);
  const shell = element('replay');
  const buttons = [...document.querySelectorAll('[data-stage]')];
  const previous = element('previous-stage');
  const next = element('next-stage');
  const play = element('play-recording');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let record;
  let stage = 0;
  let timer = null;

  const stages = [
    { title: '先把这一天说清楚', description: '目的地、日期、预算与偏好进入工作流。缺少必要字段时会暂停，等待用户补充。' },
    { title: '分别查找，再汇总证据', description: '本次记录使用固定武汉示例。两个专题分支的候选地点归并去重；实时模式则由各研究 Agent 调用高德工具。' },
    { title: '只从已有地点中编排行程', description: '提案引用证据中的 POI ID。地点名称与坐标来自证据，游览时长与选择理由保留在结构化提案中。' },
    { title: '让时间与估算预算过一遍代码', description: '校验站点引用、数量、连续交通、停留时间与估算费用。通过表示当前估算范围内可行，不是对实际票价和路况的保证。' },
    { title: '暂停，等用户做最后决定', description: '提案生成后通过持久中断等待审核。这份离线记录包含一次示例确认操作；确认从原检查点继续，不重新生成提案。' }
  ];
  const labels = {
    clarify: '核对必要需求', research_plan: '拆分研究任务', research: '专题取证',
    gather: '归并地点证据', propose: '生成结构化提案', validate: '校验时间与估算费用',
    review: '等待人工审核', fail: '未满足约束，明确结束'
  };
  function nodeStage(node) {
    const name = String(node || '').split(':')[0];
    if (name === 'clarify') return 0;
    if (['research_plan', 'research', 'gather'].includes(name)) return 1;
    if (name === 'propose') return 2;
    if (name === 'validate') return 3;
    return 4;
  }
  function nodeLabel(event) {
    if (event.type === 'interrupt') return '持久中断 · 等待补充或审核';
    if (event.type === 'complete') return '确认完成 · 终态已保存';
    if (event.type === 'error') return event.message || '执行异常';
    const parts = String(event.node || '').split(':');
    let label = labels[parts[0]] || String(event.node || '工作流事件');
    if (parts[0] === 'research' && parts[1] !== undefined) label += ` · 分支 ${Number(parts[1]) + 1}`;
    return `${event.type === 'node_end' ? '完成' : '开始'} · ${label}`;
  }
  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function fact(value, label) {
    const node = create('div', 'replay-fact');
    node.append(create('strong', '', value), create('span', '', label));
    return node;
  }
  function render() {
    if (!record) return;
    const info = stages[stage];
    element('replay-title').textContent = info.title;
    element('replay-description').textContent = info.description;
    element('replay-position').textContent = `${stage + 1} / ${stages.length}`;
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === stage)));
    previous.disabled = stage === 0;
    next.disabled = stage === stages.length - 1;
    const brief = record.brief || {};
    const context = element('replay-context');
    const transport = { walking: '步行', transit: '公共交通', driving: '自驾' }[brief.transportation] || '出行示例';
    const values = [brief.city, brief.date, transport, ...((brief.preferences || []).slice(0, 2))].filter(Boolean);
    context.replaceChildren(...values.map(value => create('span', 'context-pill', value)));
    const facts = element('replay-facts');
    const route = element('replay-route');
    const pois = new Map(record.pois.map(poi => [String(poi.id), poi]));
    const stops = Array.isArray(record.draft?.stops) ? record.draft.stops : [];
    if (stage === 0) {
      facts.replaceChildren(fact(`¥${brief.budget_max ?? '未设定'}`, '预算上限 / 人'), fact(`${brief.start_time || '—'}–${brief.end_time || '—'}`, '游玩时段'));
      route.replaceChildren(create('li', 'trace-empty', '这次示例需求完整，工作流直接进入研究阶段。'));
    } else if (stage === 1) {
      facts.replaceChildren(fact(`${record.pois.length} 个`, '去重后的来源候选'), fact('fixture', '明确标注为离线示例'));
      route.replaceChildren(...record.pois.slice(0, 4).map((poi, index) => {
        const item = create('li');
        item.append(create('span', 'stop-no', String(index + 1).padStart(2, '0')), create('span', 'stop-name', poi.name), create('span', 'stop-duration', '示例证据'));
        return item;
      }));
    } else {
      const report = record.validation || {};
      if (stage === 2) {
        facts.replaceChildren(fact(`${stops.length} 处`, '已选行程地点'), fact('POI ID', '提案与证据绑定'));
      } else if (stage === 3) {
        facts.replaceChildren(fact(`${report.duration_minutes ?? '—'} 分钟`, '含预留用餐 / 休息'), fact(`¥${report.cost_estimate ?? '—'}`, '示例费用估算 / 人'));
      } else {
        facts.replaceChildren(fact(record.status === 'completed' ? '已确认' : '已记录', '后端保存的审核结果'), fact('可恢复', '同一线程继续执行'));
      }
      route.replaceChildren(...stops.map((stop, index) => {
        const poi = pois.get(String(stop.poi_id));
        const item = create('li');
        item.append(create('span', 'stop-no', String(index + 1).padStart(2, '0')), create('span', 'stop-name', poi?.name || stop.poi_id), create('span', 'stop-duration', `${stop.visit_minutes} 分钟`));
        return item;
      }));
    }
    const events = record.events.filter(event => nodeStage(event.node) <= stage);
    const trace = element('trace-list');
    trace.replaceChildren(...events.map(event => {
      const item = create('li');
      item.append(create('span', 'trace-seq', String(event.seq).padStart(2, '0')), create('span', '', nodeLabel(event)));
      return item;
    }));
    if (!events.length) trace.replaceChildren(create('li', 'trace-empty', '该阶段没有已记录的节点事件。'));
    trace.scrollTop = trace.scrollHeight;
    element('replay-status').textContent = `第 ${stage + 1} 阶段：${info.title}。展示 ${events.length} 条已保存事件。`;
  }
  function stopPlayback() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    play.textContent = '顺序回放 ▷';
  }
  function selectStage(index) {
    stopPlayback();
    stage = Math.max(0, Math.min(stages.length - 1, index));
    render();
  }
  buttons.forEach(button => button.addEventListener('click', () => selectStage(Number(button.dataset.stage))));
  previous.addEventListener('click', () => selectStage(stage - 1));
  next.addEventListener('click', () => selectStage(stage + 1));
  play.addEventListener('click', () => {
    if (timer !== null) { stopPlayback(); return; }
    if (reducedMotion.matches) {
      selectStage(stage === stages.length - 1 ? 0 : stage + 1);
      element('replay-status').textContent += ' 已按减少动态效果偏好切换为逐步浏览。';
      return;
    }
    stage = 0;
    render();
    play.textContent = '暂停回放 Ⅱ';
    timer = setInterval(() => {
      stage += 1;
      render();
      if (stage === stages.length - 1) stopPlayback();
    }, 2400);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
  window.addEventListener('pagehide', stopPlayback);

  async function loadRecord() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(demoSrc, { signal: controller.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.mode !== 'demo' || !Array.isArray(data.pois) || !Array.isArray(data.events) || !data.brief || !data.draft || !data.validation) throw new Error('Invalid recorded demo');
      record = data;
      shell.setAttribute('aria-busy', 'false');
      buttons.forEach(button => { button.disabled = false; });
      play.disabled = false;
      render();
    } catch (_) {
      shell.setAttribute('aria-busy', 'false');
      element('replay-body').hidden = true;
      const error = element('replay-error');
      error.hidden = false;
      error.textContent = '离线执行记录暂时无法载入。你仍可阅读本页案例，并通过下方项目仓库查看源码与评测结果。';
      element('replay-status').textContent = '记录未载入，回放暂不可用。';
    } finally {
      clearTimeout(timeout);
    }
  }
  loadRecord();
})();
