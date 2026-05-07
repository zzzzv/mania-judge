import WebSocketManager from './js/socket.js'

const socket = new WebSocketManager(window.location.host)

const entries = []
let lastStateName = null
let currentReplay = null

const formatBeatmapName = (data) => {
  const artist = data?.beatmap?.artistUnicode || data?.beatmap?.artist || 'unknown artist'
  const title = data?.beatmap?.titleUnicode || data?.beatmap?.title || 'unknown title'
  const version = data?.beatmap?.version || 'unknown difficulty'
  return `${artist} - ${title} [${version}]`
}

const formatReplayTime = (value) => {
  if (!value) {
    return 'pending'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString()
}

const createEntry = (data) => {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    beatmapName: formatBeatmapName(data),
    replayTime: null,
    hitErrors: [],
  }

  entries.unshift(entry)
  return entry
}

const render = () => {
  document.body.innerHTML = ''

  if (entries.length === 0) {
    document.body.textContent = 'waiting for selectPlay...'
    return
  }

  const list = document.createElement('ol')

  for (const entry of entries) {
    const item = document.createElement('li')

    const title = document.createElement('div')
    title.textContent = entry.beatmapName

    const replayTime = document.createElement('div')
    replayTime.textContent = `replay time: ${formatReplayTime(entry.replayTime)}`

    const errors = document.createElement('div')
    errors.textContent = `hit errors: ${JSON.stringify(entry.hitErrors)}`

    item.append(title, replayTime, errors)
    list.appendChild(item)
  }

  document.body.appendChild(list)
}

socket.api_v2((data) => {
  const stateName = data?.state?.name

  if (stateName === 'play') {
    if (!currentReplay) {
      currentReplay = {
        beatmapName: formatBeatmapName(data),
        replayTime: null,
        hitErrors: [],
      }
    }

    currentReplay.beatmapName = formatBeatmapName(data)
    currentReplay.hitErrors = Array.isArray(data.play?.hitErrorArray)
      ? [...data.play.hitErrorArray]
      : []
  }

  if (lastStateName === 'play' && stateName === 'resultScreen' && currentReplay) {
    const entry = createEntry(data)
    entry.beatmapName = currentReplay.beatmapName
    entry.replayTime = data?.resultsScreen?.createdAt || new Date().toISOString()
    entry.hitErrors = currentReplay.hitErrors
    currentReplay = null
  }

  if (lastStateName === 'play' && stateName !== 'play' && stateName !== 'resultScreen' && currentReplay) {
    currentReplay = null
  }

  lastStateName = stateName
  render()

  if (stateName !== 'play') {
    return
  }
})