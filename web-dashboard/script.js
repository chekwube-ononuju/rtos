const elements = {
  unsupportedMessage: document.getElementById('unsupportedMessage'),
  statusIndicator: document.getElementById('statusIndicator'),
  connectionStatus: document.getElementById('connectionStatus'),
  deviceStatus: document.getElementById('deviceStatus'),
  lastUpdate: document.getElementById('lastUpdate'),
  toggleDevice: document.getElementById('toggleDevice'),
  refreshStatus: document.getElementById('refreshStatus'),
  requestPort: document.getElementById('requestPort'),
  connect: document.getElementById('connect'),
  disconnect: document.getElementById('disconnect'),
  portSelect: document.getElementById('portSelect'),
  logOutput: document.getElementById('logOutput'),
  clearLog: document.getElementById('clearLog')
};

if (!('serial' in navigator)) {
  elements.unsupportedMessage.classList.remove('hidden');
  disableAllControls();
} else {
  const dashboard = new SerialDashboard(elements);
  dashboard.initialize();
}

function disableAllControls() {
  [
    'toggleDevice',
    'refreshStatus',
    'requestPort',
    'connect',
    'disconnect',
    'portSelect',
    'clearLog'
  ].forEach((key) => {
    if (elements[key]) {
      elements[key].disabled = true;
    }
  });
}

class SerialDashboard {
  constructor(nodes) {
    this.nodes = nodes;
    this.availablePorts = [];
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readLoopTask = null;
    this.deviceState = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.rxBuffer = '';

    this.handlePortConnected = this.handlePortConnected.bind(this);
    this.handlePortDisconnected = this.handlePortDisconnected.bind(this);
  }

  async initialize() {
    this.attachEventHandlers();
    await this.refreshPortList();

    navigator.serial.addEventListener('connect', this.handlePortConnected);
    navigator.serial.addEventListener('disconnect', this.handlePortDisconnected);
    window.addEventListener('beforeunload', () => {
      void this.safeDisconnect(true);
    });

    this.log('Web Serial ready. Request access to your STM32 virtual COM port to begin.');
  }

  attachEventHandlers() {
    this.nodes.requestPort.addEventListener('click', () => {
      void this.requestPort();
    });

    this.nodes.connect.addEventListener('click', () => {
      void this.openSelectedPort();
    });

    this.nodes.disconnect.addEventListener('click', () => {
      void this.safeDisconnect();
    });

    this.nodes.toggleDevice.addEventListener('click', () => {
      void this.toggleDevice();
    });

    this.nodes.refreshStatus.addEventListener('click', () => {
      void this.requestStatus();
    });

    this.nodes.clearLog.addEventListener('click', () => {
      this.nodes.logOutput.textContent = 'Log cleared.';
    });
  }

  async refreshPortList() {
    try {
      this.availablePorts = await navigator.serial.getPorts();
      this.populatePortSelect();
    } catch (error) {
      this.log(`Unable to enumerate ports: ${error.message}`, 'error');
    }
  }

  populatePortSelect() {
    const { portSelect } = this.nodes;
    portSelect.innerHTML = '';

    if (this.availablePorts.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No ports detected';
      portSelect.appendChild(option);
      portSelect.disabled = true;
      this.nodes.connect.disabled = true;
      return;
    }

    this.availablePorts.forEach((port, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = this.describePort(port, index);
      portSelect.appendChild(option);
    });

    portSelect.disabled = this.isConnected;
    this.nodes.connect.disabled = this.isConnected;
  }

  describePort(port, index) {
    const info = port.getInfo?.() ?? {};
    const vendor = typeof info.usbVendorId === 'number'
      ? `VID 0x${info.usbVendorId.toString(16).padStart(4, '0')}`
      : null;
    const product = typeof info.usbProductId === 'number'
      ? `PID 0x${info.usbProductId.toString(16).padStart(4, '0')}`
      : null;
    const labelParts = [vendor, product].filter(Boolean);
    const prefix = `Port ${index + 1}`;
    return labelParts.length ? `${prefix} • ${labelParts.join(' / ')}` : prefix;
  }

  async requestPort() {
    try {
      const port = await navigator.serial.requestPort();
      if (!this.availablePorts.includes(port)) {
        this.availablePorts.push(port);
      }
      this.populatePortSelect();
      const newIndex = this.availablePorts.indexOf(port);
      if (newIndex >= 0) {
        this.nodes.portSelect.value = String(newIndex);
      }
      this.nodes.connect.disabled = false;
      this.log('Serial port access granted. Select the port and click Connect.');
    } catch (error) {
      if (error.name !== 'NotFoundError') {
        this.log(`Port request cancelled or failed: ${error.message}`, 'error');
      }
    }
  }

  async openSelectedPort() {
    if (this.isConnecting) {
      return;
    }

    const selectedValue = this.nodes.portSelect.value;
    const selectedIndex = Number.parseInt(selectedValue, 10);
    if (Number.isNaN(selectedIndex) || !this.availablePorts[selectedIndex]) {
      this.log('Select a serial port before connecting.', 'error');
      return;
    }

    this.isConnecting = true;
    this.nodes.connect.disabled = true;
    this.nodes.requestPort.disabled = true;

    try {
      if (this.port) {
        await this.safeDisconnect(true);
      }

      const targetPort = this.availablePorts[selectedIndex];
      await targetPort.open({ baudRate: 115200 });

      this.port = targetPort;
      this.writer = this.port.writable?.getWriter ? this.port.writable.getWriter() : null;
      this.reader = this.port.readable?.getReader ? this.port.readable.getReader() : null;

      this.setConnectionState(true);
      this.log(`Connected to ${this.describePort(targetPort, selectedIndex)}.`);

      this.startReadLoop();
      await this.requestStatus();
    } catch (error) {
      this.log(`Failed to open port: ${error.message}`, 'error');
      await this.safeDisconnect(true);
    } finally {
      this.isConnecting = false;
      if (!this.isConnected) {
        this.nodes.connect.disabled = this.availablePorts.length === 0;
        this.nodes.requestPort.disabled = false;
      }
    }
  }

  async safeDisconnect(silent = false) {
    if (!this.port && !this.reader && !this.writer) {
      this.setConnectionState(false);
      return;
    }

    try {
      if (this.reader) {
        try {
          await this.reader.cancel();
        } catch (error) {
          // Swallow cancellation errors.
        }
        this.reader.releaseLock();
        this.reader = null;
      }

      if (this.writer) {
        try {
          await this.writer.close?.();
        } catch (error) {
          // Closing may fail if the port was unplugged.
        }
        this.writer.releaseLock();
        this.writer = null;
      }

      if (this.port) {
        try {
          await this.port.close();
        } catch (error) {
          // Ignore close failures.
        }
        this.port = null;
      }
    } finally {
      this.setConnectionState(false);
      this.populatePortSelect();
      this.nodes.requestPort.disabled = false;
      if (!silent) {
        this.log('Serial connection closed.');
      }
    }
  }

  setConnectionState(connected) {
    this.isConnected = connected;
    this.nodes.connectionStatus.textContent = connected
      ? `Connected • ${this.connectionLabel()}`
      : 'Disconnected';

    this.nodes.connect.disabled = connected || this.availablePorts.length === 0;
    this.nodes.disconnect.disabled = !connected;
    this.nodes.toggleDevice.disabled = !connected;
    this.nodes.refreshStatus.disabled = !connected;
    this.nodes.portSelect.disabled = connected || this.availablePorts.length === 0;
    this.nodes.requestPort.disabled = connected;

    if (!connected) {
      this.deviceState = null;
      this.updateLastUpdate();
    }

    this.updateDeviceStateUi();
  }

  connectionLabel() {
    if (!this.port) {
      return 'Serial port';
    }
    const index = this.availablePorts.indexOf(this.port);
    return index >= 0 ? this.describePort(this.port, index) : 'Serial port';
  }

  updateDeviceStateUi() {
    if (!this.isConnected) {
      this.nodes.statusIndicator.dataset.state = 'disconnected';
      this.nodes.deviceStatus.textContent = 'Device state: Unknown';
      this.nodes.toggleDevice.textContent = 'Turn On';
      return;
    }

    if (this.deviceState === 1) {
      this.nodes.statusIndicator.dataset.state = 'on';
      this.nodes.deviceStatus.textContent = 'Device state: On';
      this.nodes.toggleDevice.textContent = 'Turn Off';
    } else if (this.deviceState === 0) {
      this.nodes.statusIndicator.dataset.state = 'off';
      this.nodes.deviceStatus.textContent = 'Device state: Off';
      this.nodes.toggleDevice.textContent = 'Turn On';
    } else {
      this.nodes.statusIndicator.dataset.state = 'unknown';
      this.nodes.deviceStatus.textContent = 'Device state: Unknown';
      this.nodes.toggleDevice.textContent = 'Turn On';
    }
  }

  async startReadLoop() {
    if (!this.reader) {
      return;
    }

    const decoder = new TextDecoder();

    const loop = async () => {
      try {
        while (this.reader) {
          const { value, done } = await this.reader.read();
          if (done) {
            break;
          }

          if (value) {
            this.rxBuffer += decoder.decode(value, { stream: true });
            this.processIncomingBuffer();
          }
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          this.log(`Read error: ${error.message}`, 'error');
        }
      } finally {
        this.rxBuffer = '';
      }
    };

    this.readLoopTask = loop();
  }

  processIncomingBuffer() {
    let newlineIndex = this.rxBuffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const rawLine = this.rxBuffer.slice(0, newlineIndex).trim();
      this.rxBuffer = this.rxBuffer.slice(newlineIndex + 1);

      if (rawLine.length > 0) {
        this.handleIncomingLine(rawLine);
      }

      newlineIndex = this.rxBuffer.indexOf('\n');
    }
  }

  handleIncomingLine(line) {
    this.log(`RX ${line}`, 'rx');

    if (line.startsWith('STATE:')) {
      const [, value] = line.split(':');
      const state = (value ?? '').trim();
      if (state === '1') {
        this.deviceState = 1;
        this.updateDeviceStateUi();
        this.updateLastUpdate(new Date());
      } else if (state === '0') {
        this.deviceState = 0;
        this.updateDeviceStateUi();
        this.updateLastUpdate(new Date());
      }
    }
  }

  async toggleDevice() {
    if (!this.writer) {
      return;
    }

    const nextCommand = this.deviceState === 1 ? '0' : '1';
    await this.sendCommand(nextCommand, nextCommand === '1' ? 'TX Request ON' : 'TX Request OFF');
  }

  async requestStatus() {
    if (!this.writer) {
      return;
    }

    await this.sendCommand('S', 'TX Request STATUS');
  }

  async sendCommand(command, label) {
    if (!this.writer) {
      this.log('Cannot send command: serial writer unavailable.', 'error');
      return;
    }

    try {
      const encoder = new TextEncoder();
      await this.writer.write(encoder.encode(command));
      this.log(label ?? `TX ${command}`, 'tx');
    } catch (error) {
      this.log(`Write error: ${error.message}`, 'error');
    }
  }

  updateLastUpdate(date) {
    if (!date) {
      this.nodes.lastUpdate.textContent = 'Last update: --';
      return;
    }

    const formatted = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    this.nodes.lastUpdate.textContent = `Last update: ${formatted}`;
  }

  handlePortConnected(event) {
    const port = event.target;
    if (!this.availablePorts.includes(port)) {
      this.availablePorts.push(port);
    }
    this.populatePortSelect();
    this.log('Serial device connected.', 'info');
  }

  async handlePortDisconnected(event) {
    const port = event.target;
    this.availablePorts = this.availablePorts.filter((p) => p !== port);
    if (this.port === port) {
      await this.safeDisconnect(true);
      this.log('Active serial device disconnected.', 'error');
    } else {
      this.log('Serial device disconnected.', 'info');
    }
    this.populatePortSelect();
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      info: 'INFO',
      error: 'ERROR',
      tx: 'TX',
      rx: 'RX'
    }[type] ?? 'LOG';

    const entry = `[${timestamp}] ${prefix}: ${message}`;
    const current = this.nodes.logOutput.textContent === 'Web Serial idle…'
      ? []
      : this.nodes.logOutput.textContent.split('\n');

    current.push(entry);
    if (current.length > 300) {
      current.splice(0, current.length - 300);
    }

    this.nodes.logOutput.textContent = current.join('\n');
    this.nodes.logOutput.scrollTop = this.nodes.logOutput.scrollHeight;
  }
}
