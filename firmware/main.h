#ifndef MAIN_H
#define MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32l4xx_hal.h"

/* Default device control pin configuration.
 * Adjust these macros to match the board wiring.
 */
#ifndef DEVICE_GPIO_Port
#define DEVICE_GPIO_Port GPIOA
#endif

#ifndef DEVICE_Pin
#define DEVICE_Pin GPIO_PIN_5
#endif

void Error_Handler(void);

#ifdef __cplusplus
}
#endif

#endif /* MAIN_H */
