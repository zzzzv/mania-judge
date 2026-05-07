class WebSocketManager {
  constructor(host) {
    this.host = host
    this.sockets = {}
  }

  createConnection(url, callback, filters) {
    const socket = new WebSocket(`ws://${this.host}${url}?l=${encodeURI(window.COUNTER_PATH || '')}`)
    this.sockets[url] = socket

    socket.onopen = () => {
      if (Array.isArray(filters)) {
        socket.send(`applyFilters:${JSON.stringify(filters)}`)
      }
    }

    socket.onclose = () => {
      delete this.sockets[url]
      setTimeout(() => this.createConnection(url, callback, filters), 1000)
    }

    socket.onerror = () => {}

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.error || data?.message?.error) {
          return
        }

        callback(data)
      } catch {
        // Ignore malformed payloads and wait for the next message.
      }
    }
  }

  api_v2(callback, filters) {
    this.createConnection('/websocket/v2', callback, filters)
  }
}

export default WebSocketManager