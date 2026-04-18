const vnStage = document.getElementById('vnStage')
const chatLog = document.getElementById('chatLog')
const chatForm = document.getElementById('chatForm')
const userInput = document.getElementById('userInput')
const modelInput = document.getElementById('modelInput')
const maxTokensInput = document.getElementById('maxTokensInput')
const resetBtn = document.getElementById('resetBtn')
const sendBtn = document.getElementById('sendBtn')
const dialogText = document.getElementById('dialogText')
const speakerName = document.getElementById('speakerName')
const settingsPanel = document.getElementById('settingsPanel')
const logPanel = document.getElementById('logPanel')
const opsPanel = document.getElementById('opsPanel')
const opsLog = document.getElementById('opsLog')
const toggleOpsBtn = document.getElementById('toggleOpsBtn')
const toggleSettingsBtn = document.getElementById('toggleSettingsBtn')
const toggleLogBtn = document.getElementById('toggleLogBtn')
const choiceButtons = Array.from(document.querySelectorAll('.choice'))
const bgUrlInput = document.getElementById('bgUrlInput')
const charaUrlInput = document.getElementById('charaUrlInput')
const bgFileInput = document.getElementById('bgFileInput')
const charaFileInput = document.getElementById('charaFileInput')
const applySkinBtn = document.getElementById('applySkinBtn')
const cancelBtn = document.getElementById('cancelBtn')
const streamModeCheckbox = document.getElementById('streamModeCheckbox')
const usageLine = document.getElementById('usageLine')

const storySystemPrompt = `
你现在扮演 galgame 角色「辉夜露卡」。
要求：
1) 风格：可爱、温柔、带一点俏皮。
2) 当用户提出开发任务时，优先调用本地 Claude Code 能力（读写文件、执行命令、检索代码）并给出真实结果。
3) 不编造执行结果，不虚构文件内容。
4) 如果用户提供了 URL，或明确要求查看网页、文档、官网、在线资料，优先调用网页读取/搜索工具获取真实内容后再回答，不要只凭记忆概述。
5) 回复保持自然口吻，不要输出模板化免责声明。
6) 每次回复的单段台词不能超过25个字（不包含代码块等）。如果内容较多，请自动使用「[NEXT]」作为分隔符将文本分为多帧输出。例如：第一句话[NEXT]第二句话[NEXT]第三句话。
7) 如果遇到不确定的需求、或者有多种实现方案（类似 plan mode）需要玩家做决定时，请在回复的最后加上 JSON 格式的选项，例如：<options>["使用 React", "使用 Vue", "让我再想想"]</options>。系统会自动将其渲染为游戏界面的交互按钮。
`.trim()

const state = {
  busy: false,
  sessionId: localStorage.getItem('galgame_session_id') || '',
  typewriterTimer: null,
  isTyping: false,
  currentFrameFullText: '',
  lastOpsKey: '',
  abortController: null,
}

if (streamModeCheckbox) {
  streamModeCheckbox.checked =
    localStorage.getItem('galgame_stream_mode') === '1'
  streamModeCheckbox.addEventListener('change', () => {
    localStorage.setItem(
      'galgame_stream_mode',
      streamModeCheckbox.checked ? '1' : '0',
    )
  })
}

function stripThinkingReply(text) {
  const s = String(text ?? '')
  // 先移除闭合的 think 块（兼容多种标签名）
  const removed = s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '')
    .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/g, '')

  // 流式增量时可能只出现开标签，先把开标签后的内容隐藏，避免对话框闪现 <think>
  const openTags = ['<think>', '<thinking>', '<reasoning>', '<redacted_thinking>']
  let cut = removed
  for (const t of openTags) {
    const idx = cut.indexOf(t)
    if (idx >= 0) cut = cut.slice(0, idx)
  }

  return cut.trim()
}

function formatUsage(u) {
  if (!u || typeof u !== 'object') return '—'
  const i = u.input_tokens ?? 0
  const o = u.output_tokens ?? 0
  let s = `入 ${i} · 出 ${o}`
  if (u.cache_read_input_tokens)
    s += ` · 缓存读 ${u.cache_read_input_tokens}`
  if (u.cache_creation_input_tokens)
    s += ` · 缓存写 ${u.cache_creation_input_tokens}`
  return s
}

function updateUsageLine(usage) {
  if (!usageLine) return
  usageLine.textContent = `用量：${formatUsage(usage)}`
}

let typeWriterResolve = null
let advanceResolve = null

function typeWriterEffect(element, text, speed = 30) {
  if (state.typewriterTimer) clearInterval(state.typewriterTimer)
  if (typeWriterResolve) {
    typeWriterResolve()
    typeWriterResolve = null
  }

  element.textContent = ''
  element.classList.add('typing-cursor')
  state.isTyping = true
  state.currentFrameFullText = text

  let i = 0

  return new Promise((resolve) => {
    typeWriterResolve = resolve
    state.typewriterTimer = setInterval(() => {
      if (i < text.length) {
        element.textContent += text.charAt(i)
        i++
      } else {
        clearInterval(state.typewriterTimer)
        element.classList.remove('typing-cursor')
        state.isTyping = false
        if (typeWriterResolve) {
          typeWriterResolve()
          typeWriterResolve = null
        }
      }
    }, speed)
  })
}

function skipTypeWriter() {
  if (state.isTyping) {
    clearInterval(state.typewriterTimer)
    dialogText.textContent = state.currentFrameFullText
    dialogText.classList.remove('typing-cursor')
    state.isTyping = false
    if (typeWriterResolve) {
      typeWriterResolve()
      typeWriterResolve = null
    }
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.panel') || e.target.closest('.options-overlay:not(.hidden)')) {
    return
  }

  if (state.isTyping) {
    skipTypeWriter()
  } else if (advanceResolve) {
    advanceResolve()
    advanceResolve = null
  }
})

async function setCurrentLine(role, text, animate = true) {
  speakerName.textContent =
    role === 'assistant' ? '辉夜露卡 ✦' : role === 'user' ? '玩家' : '系统'

  if (animate) {
    await typeWriterEffect(dialogText, text, 25)
  } else {
    skipTypeWriter()
    dialogText.classList.remove('typing-cursor')
    dialogText.textContent = text
  }
}

async function playFrames(role, frames) {
  for (let i = 0; i < frames.length; i++) {
    const frameText = frames[i]
    await setCurrentLine(role, frameText, true)

    if (i < frames.length - 1) {
      dialogText.classList.add('waiting-next')
      await new Promise(resolve => { advanceResolve = resolve })
      dialogText.classList.remove('waiting-next')
    }
  }
}

function appendHistory(role, text) {
  const row = document.createElement('div')
  row.className = `msg ${role}`

  const title = document.createElement('div')
  title.className = 'role'
  title.textContent =
    role === 'assistant' ? '辉夜露卡' : role === 'user' ? '玩家' : '系统'

  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = text

  row.appendChild(title)
  row.appendChild(bubble)
  chatLog.appendChild(row)
  chatLog.scrollTop = chatLog.scrollHeight
}

function appendOps(ops = []) {
  if (!opsLog) return
  if (!Array.isArray(ops) || ops.length === 0) return

  function diffClassForLine(line) {
    if (!line) return 'diff-line diff-line--empty'
    if (line.startsWith('+++') || line.startsWith('---'))
      return 'diff-line diff-line--file'
    if (line.startsWith('@@')) return 'diff-line diff-line--hunk'
    if (line.startsWith('+')) return 'diff-line diff-line--add'
    if (line.startsWith('-')) return 'diff-line diff-line--del'
    if (line.startsWith('diff ') || line.startsWith('index '))
      return 'diff-line diff-line--meta'
    return 'diff-line diff-line--ctx'
  }

  for (const op of ops) {
    const toolName = op?.tool_name || 'Tool'
    const output = typeof op?.output === 'string' ? op.output : JSON.stringify(op?.output ?? '')
    const key = `${op?.tool_use_id || ''}:${toolName}:${output.length}`
    if (key && key === state.lastOpsKey) continue
    state.lastOpsKey = key

    const item = document.createElement('div')
    item.className = 'ops-item'

    const title = document.createElement('div')
    title.className = 'title'
    title.textContent = toolName

    const pre = document.createElement('pre')
    pre.className = 'diff'
    const lines = String(output ?? '').replace(/\r\n/g, '\n').split('\n')
    for (const line of lines) {
      const div = document.createElement('div')
      div.className = diffClassForLine(line)
      div.textContent = line
      pre.appendChild(div)
    }

    item.appendChild(title)
    item.appendChild(pre)
    opsLog.appendChild(item)
  }

  opsLog.scrollTop = opsLog.scrollHeight
}

function buildPayload(userText) {
  return {
    message: `${storySystemPrompt}\n\n用户输入：${userText}`,
    sessionId: state.sessionId || undefined,
    model: modelInput.value.trim() || 'MiniMax-M2.7-highspeed',
    maxTokens: Number(maxTokensInput.value || 900),
  }
}

async function callApi(userText, signal) {
  const payload = buildPayload(userText)

  const response = await fetch('/api/cc/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.ok === false) {
    const msg =
      data?.error || data?.error?.message || `请求失败（HTTP ${response.status}）`
    throw new Error(msg)
  }
  if (data?.sessionId) {
    state.sessionId = data.sessionId
    localStorage.setItem('galgame_session_id', state.sessionId)
  }
  return data
}

function parseReplyAndOptions(rawReply) {
  let reply =
    typeof rawReply === 'string' && rawReply.trim()
      ? rawReply.trim()
      : '这次没有拿到有效文本回复。'

  reply = stripThinkingReply(reply)

  let parsedOptions = null
  const optionsMatch = reply.match(/<options>([\s\S]*?)<\/options>/)
  if (optionsMatch) {
    try {
      parsedOptions = JSON.parse(optionsMatch[1])
    } catch (e) {
      console.error('Failed to parse options:', e)
    }
    reply = reply.replace(/<options>[\s\S]*?<\/options>/, '').trim()
  }

  const frames = reply.split('[NEXT]').map(s => s.trim()).filter(Boolean)
  if (frames.length === 0) frames.push('这次没有拿到有效文本回复。')

  return { reply, parsedOptions, frames }
}

function assistantTextFromSdkEv(ev) {
  const content = ev?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(c => c?.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('')
}

async function readSSEStream(response, onEvent) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, sep).trim()
      buffer = buffer.slice(sep + 2)
      if (chunk.startsWith('data: ')) {
        const json = JSON.parse(chunk.slice(6))
        await onEvent(json)
      }
    }
  }
}

async function callApiStream(userText, signal) {
  const payload = buildPayload(userText)
  const response = await fetch('/api/cc/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}))
    throw new Error(
      errBody?.error || `流式请求失败（HTTP ${response.status}）`,
    )
  }

  let donePayload = null
  await readSSEStream(response, async (msg) => {
    if (msg.type === 'ready' && msg.sessionId) {
      state.sessionId = msg.sessionId
      localStorage.setItem('galgame_session_id', state.sessionId)
      return
    }
    if (msg.type === 'error') {
      throw new Error(msg.message || '流式请求出错')
    }
    if (msg.type === 'sdk' && msg.ev) {
      const e = msg.ev
      if (e.type === 'tool_result') {
        appendOps([
          {
            tool_use_id: e.result?.tool_use_id,
            tool_name: e.result?.tool_name,
            output: e.result?.output,
          },
        ])
      } else if (e.type === 'assistant') {
        const t = assistantTextFromSdkEv(e)
        if (t) {
          skipTypeWriter()
          speakerName.textContent = '辉夜露卡 ✦'
          dialogText.classList.remove('typing-cursor')
          dialogText.textContent = stripThinkingReply(t)
        }
      } else if (e.type === 'partial_message' && e.partial?.type === 'text') {
        const t = e.partial.text
        if (typeof t === 'string' && t) {
          skipTypeWriter()
          speakerName.textContent = '辉夜露卡 ✦'
          dialogText.classList.remove('typing-cursor')
          dialogText.textContent = stripThinkingReply(t)
        }
      }
      return
    }
    if (msg.type === 'done') {
      donePayload = msg
    }
  })

  if (!donePayload?.ok) {
    throw new Error(donePayload?.message || '流式结束但未收到完成包')
  }
  if (donePayload.sessionId) {
    state.sessionId = donePayload.sessionId
    localStorage.setItem('galgame_session_id', state.sessionId)
  }
  return {
    reply: donePayload.reply || '',
    usage: donePayload.usage,
    ops: donePayload.ops || [],
  }
}

async function cancelInFlight() {
  if (state.sessionId) {
    try {
      await fetch('/api/cc/chat/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId }),
      })
    } catch (_) {
      /* ignore */
    }
  }
  state.abortController?.abort()
}

async function sendMessage(text) {
  const clean = text.trim()
  if (!clean || state.busy) return
  state.busy = true
  sendBtn.disabled = true
  if (cancelBtn) cancelBtn.disabled = false
  state.abortController = new AbortController()
  const signal = state.abortController.signal

  setCurrentLine('user', clean, false) // 用户输入不用打字机效果
  appendHistory('user', clean)

  const useStream = streamModeCheckbox?.checked

  setTimeout(() => {
    if (state.busy && !useStream) {
      setCurrentLine('system', '露卡正在思考中...', true)
    } else if (state.busy && useStream) {
      setCurrentLine('system', '露卡正在连接…', false)
    }
  }, 400)

  try {
    let data
    if (useStream) {
      data = await callApiStream(clean, signal)
    } else {
      data = await callApi(clean, signal)
      if (data?.ops) appendOps(data.ops)
    }

    if (data?.usage !== undefined) updateUsageLine(data.usage)

    const { reply, parsedOptions, frames } = parseReplyAndOptions(data?.reply)

    appendHistory('assistant', reply.replace(/\[NEXT\]/g, ' '))

    if (useStream && frames.length <= 1) {
      skipTypeWriter()
      speakerName.textContent = '辉夜露卡 ✦'
      await setCurrentLine('assistant', frames[0], false)
    } else {
      await playFrames('assistant', frames)
    }
    renderOptions(parsedOptions)
  } catch (error) {
    if (error?.name === 'AbortError') {
      const msg = '已停止生成。'
      await setCurrentLine('system', msg, false)
      appendHistory('system', msg)
    } else {
      const msg = `通信异常：${error instanceof Error ? error.message : String(error)}`
      await setCurrentLine('system', msg, false)
      appendHistory('system', msg)
    }
  } finally {
    state.busy = false
    state.abortController = null
    sendBtn.disabled = false
    if (cancelBtn) cancelBtn.disabled = true
    userInput.focus()
  }
}

function togglePanel(panel, otherPanel) {
  panel.classList.toggle('hidden')
  if (!otherPanel.classList.contains('hidden') && !panel.classList.contains('hidden')) {
    otherPanel.classList.add('hidden')
  }
}

chatForm.addEventListener('submit', async e => {
  e.preventDefault()
  const text = userInput.value
  userInput.value = ''
  await sendMessage(text)
})

// 回车发送，Shift+回车换行
userInput.addEventListener('keydown', async e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    const text = userInput.value
    userInput.value = ''
    await sendMessage(text)
  }
})

if (cancelBtn) {
  cancelBtn.addEventListener('click', () => {
    void cancelInFlight()
  })
}

resetBtn.addEventListener('click', () => {
  state.sessionId = ''
  localStorage.removeItem('galgame_session_id')
  chatLog.innerHTML = ''
  if (opsLog) opsLog.innerHTML = ''
  setCurrentLine('system', '新章节开启。你可以继续推进剧情或直接下达开发任务。', true)
  appendHistory('system', '新章节开启。')
})

toggleSettingsBtn.addEventListener('click', () => togglePanel(settingsPanel, logPanel))
toggleLogBtn.addEventListener('click', () => togglePanel(logPanel, settingsPanel))

toggleOpsBtn.addEventListener('click', () => {
  // 打开步骤栏时，关闭右侧面板，避免重叠
  if (!opsPanel.classList.contains('hidden')) {
    opsPanel.classList.add('hidden')
    vnStage.classList.remove('ops-open')
    return
  }
  opsPanel.classList.remove('hidden')
  vnStage.classList.add('ops-open')
  settingsPanel.classList.add('hidden')
  logPanel.classList.add('hidden')
})

const optionsOverlay = document.getElementById('optionsOverlay')

function renderOptions(optionsList) {
  optionsOverlay.innerHTML = ''
  if (!optionsList || !Array.isArray(optionsList) || optionsList.length === 0) {
    optionsOverlay.classList.add('hidden')
    return
  }
  optionsOverlay.classList.remove('hidden')
  optionsList.forEach(opt => {
    const btn = document.createElement('button')
    btn.className = 'choice-btn'
    btn.type = 'button'
    btn.textContent = opt
    btn.dataset.text = opt
    btn.addEventListener('click', async () => {
      userInput.value = ''
      optionsOverlay.innerHTML = ''
      optionsOverlay.classList.add('hidden')
      await sendMessage(opt)
    })
    optionsOverlay.appendChild(btn)
  })
}

choiceButtons.forEach(button => {
  button.addEventListener('click', async () => {
    const text = button.dataset.text || ''
    userInput.value = ''
    optionsOverlay.innerHTML = ''
    optionsOverlay.classList.add('hidden')
    await sendMessage(text)
  })
})

applySkinBtn.addEventListener('click', () => {
  const bg = bgUrlInput.value.trim()
  const chara = charaUrlInput.value.trim()
  const bgFile = bgFileInput?.files?.[0]
  const charaFile = charaFileInput?.files?.[0]

  if (bgFile) {
    const bgBlobUrl = URL.createObjectURL(bgFile)
    vnStage.style.setProperty('--bg-image', `url('${bgBlobUrl}')`)
  }
  if (charaFile) {
    const charaBlobUrl = URL.createObjectURL(charaFile)
    vnStage.style.setProperty('--chara-image', `url('${charaBlobUrl}')`)
  }
  if (bg) vnStage.style.setProperty('--bg-image', `url('${bg}')`)
  if (chara) vnStage.style.setProperty('--chara-image', `url('${chara}')`)
})

// 初始欢迎语带打字机效果
appendHistory('assistant', '主人，欢迎来到图书馆。今天想推进剧情，还是开始写代码呢？')
playFrames('assistant', ['主人，欢迎来到图书馆。', '今天想推进剧情，还是开始写代码呢？'])
