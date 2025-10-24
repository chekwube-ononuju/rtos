# RTOS Device Control Dashboard

A reference project that pairs STM32L4 FreeRTOS firmware with a browser based dashboard so you can switch a desk lamp or fan on and off from Chrome or Edge. The two halves talk over a simple UART protocol routed through the board’s virtual COM port.

## Project Layout

```
rtos/
├── firmware
│   ├── main.c          # FreeRTOS entry point with control/comm tasks
│   └── main.h          # Pin configuration and error handler prototype
└── web-dashboard
    ├── index.html      # Dashboard markup
    ├── styles.css      # UI styling
    └── script.js       # Web Serial controller logic
```

## STM32L4 Firmware

Key features implemented in `firmware/main.c`:

- Initializes GPIO and USART2, then boots the CMSIS-RTOS2 scheduler.
- Uses a message queue to move commands from the UART task to the control task.
- `ControlTask`: Drives `DEVICE_Pin` high/low to toggle the lamp/fan.
- `CommsTask`: Blocks on UART reads, validates commands (`0`, `1`, `S`), replays the queue state, and re-initializes the UART if an error is detected.
- Replies to every valid command with `STATE:0` or `STATE:1` to keep the host in sync.

### Hardware configuration

Edit `firmware/main.h` to match your wiring. By default the project assumes:

- `DEVICE_Pin` on `GPIOA` pin 5.
- USART2 as the communication channel (PA2/PA3 on the Nucleo-L476RG).

Regenerate the HAL peripheral initialisation code with STM32CubeMX/STM32CubeIDE if your target board differs.

### Building and flashing

1. Create a new STM32CubeIDE project for your exact MCU and copy `firmware/main.c` and `firmware/main.h` into the `Core/Src` and `Core/Inc` folders respectively.
2. Enable FreeRTOS/CMSIS‑RTOS2, GPIO, and USART2 in CubeMX and regenerate the code.
3. Build and flash the project to the board.
4. Open a serial terminal at 115200 baud to confirm that the firmware responds with `STATE:0`/`STATE:1` when you send `S`, `0`, or `1`.

## Web Dashboard

The UI in `web-dashboard/` relies on the Web Serial API.

### Prerequisites

- Chrome or Edge version 89+ on desktop.
- Web Serial enabled (check `chrome://flags/#enable-experimental-web-platform-features` if needed).
- A lightweight static server (examples below).

### Run locally

```bash
cd web-dashboard
python3 -m http.server 8000
```

Navigate to `http://localhost:8000` and grant serial access to your board.

### Features

- Connection manager with port discovery, request flow, and graceful disconnects.
- Real-time status indicator and last-update timestamp.
- Action buttons to toggle power and poll the firmware (`S` command).
- Scrollable serial log that captures TX/RX frames and errors.
- Automatic reconnection handling when USB cables are unplugged.

## UART Protocol

All messages are ASCII terminated with `\n`.

| Host command | Description            | Firmware response      |
|--------------|------------------------|------------------------|
| `0`          | Request device OFF     | `STATE:0`              |
| `1`          | Request device ON      | `STATE:1`              |
| `S` / `s`    | Query current state    | `STATE:0` or `STATE:1` |

The firmware also emits the same `STATE:x` frame after processing every command, making the exchange idempotent.

## Quick Start

1. Flash the STM32L4 firmware and power the board.
2. Serve the `web-dashboard` directory and open it in Chrome/Edge.
3. Click **Request Port Access**, choose the board’s virtual COM port, then **Connect**.
4. Use **Turn On/Off** and **Refresh Status** to drive the device and verify feedback in the serial log.

## Troubleshooting

- **Web Serial unsupported**: Use a recent desktop Chrome or Edge build; mobile browsers are not supported.
- **No ports detected**: Ensure the board enumerates as a CDC serial device and that the USB cable carries data.
- **Stale state**: The dashboard waits for `STATE:` frames. If you extend the firmware protocol, keep this response to maintain compatibility.
- **UART recoveries**: The firmware reinitialises USART2 after HAL errors; persistent faults usually point to wiring or clock configuration issues.

## Security Notes

The serial link is intentionally simple and unauthenticated. Add higher‑level validation, encryption, or access control before using this approach outside of a trusted lab environment.
