#include "main.h"
#include "cmsis_os2.h"
#include "usart.h"
#include "gpio.h"

#include <stdint.h>
#include <stdio.h>

#define COMMAND_QUEUE_LENGTH       16U
#define COMMAND_QUEUE_ITEM_SIZE    sizeof(uint8_t)
#define TASK_STACK_BYTES           (256U * sizeof(uint32_t))

static osThreadId_t controlTaskHandle;
static osThreadId_t communicationTaskHandle;
static osMessageQueueId_t commandQueue;
static volatile uint8_t deviceState = 0;

static void StartControlTask(void *argument);
static void StartCommunicationTask(void *argument);
static void ApplyDeviceCommand(uint8_t command);
static void SendStateOverUart(void);

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();

  MX_GPIO_Init();
  MX_USART2_UART_Init();

  if (osKernelInitialize() != osOK)
  {
    Error_Handler();
  }

  commandQueue = osMessageQueueNew(COMMAND_QUEUE_LENGTH, COMMAND_QUEUE_ITEM_SIZE, NULL);
  if (commandQueue == NULL)
  {
    Error_Handler();
  }

  const osThreadAttr_t controlTaskAttr = {
    .name = "ControlTask",
    .priority = osPriorityNormal,
    .stack_size = TASK_STACK_BYTES
  };

  const osThreadAttr_t commTaskAttr = {
    .name = "CommsTask",
    .priority = osPriorityNormal,
    .stack_size = TASK_STACK_BYTES
  };

  controlTaskHandle = osThreadNew(StartControlTask, NULL, &controlTaskAttr);
  if (controlTaskHandle == NULL)
  {
    Error_Handler();
  }

  communicationTaskHandle = osThreadNew(StartCommunicationTask, NULL, &commTaskAttr);
  if (communicationTaskHandle == NULL)
  {
    Error_Handler();
  }

  if (osKernelStart() != osOK)
  {
    Error_Handler();
  }

  for (;;)
  {
  }
}

static void StartControlTask(void *argument)
{
  (void)argument;
  uint8_t command = 0;

  for (;;)
  {
    if (osMessageQueueGet(commandQueue, &command, NULL, osWaitForever) == osOK)
    {
      ApplyDeviceCommand(command);
      SendStateOverUart();
    }

    osDelay(1);
  }
}

static void StartCommunicationTask(void *argument)
{
  (void)argument;
  uint8_t rxByte = 0;

  for (;;)
  {
    HAL_StatusTypeDef status = HAL_UART_Receive(&huart2, &rxByte, 1, HAL_MAX_DELAY);
    if (status == HAL_OK)
    {
      if (rxByte == '0' || rxByte == '1')
      {
        uint8_t command = (uint8_t)(rxByte - '0');
        if (osMessageQueuePut(commandQueue, &command, 0, 0) != osOK)
        {
          SendStateOverUart();
        }
      }
      else if (rxByte == 'S' || rxByte == 's')
      {
        SendStateOverUart();
      }
    }
    else if (status == HAL_ERROR)
    {
      HAL_UART_DeInit(&huart2);
      MX_USART2_UART_Init();
    }

    osDelay(1);
  }
}

static void ApplyDeviceCommand(uint8_t command)
{
  switch (command)
  {
    case 0:
      HAL_GPIO_WritePin(DEVICE_GPIO_Port, DEVICE_Pin, GPIO_PIN_RESET);
      deviceState = 0;
      break;

    case 1:
      HAL_GPIO_WritePin(DEVICE_GPIO_Port, DEVICE_Pin, GPIO_PIN_SET);
      deviceState = 1;
      break;

    default:
      break;
  }
}

static void SendStateOverUart(void)
{
  uint8_t txData[16];
  int length = snprintf((char *)txData, sizeof(txData), "STATE:%u\n", (unsigned int)deviceState);

  if (length > 0 && length < (int)sizeof(txData))
  {
    HAL_UART_Transmit(&huart2, txData, (uint16_t)length, HAL_MAX_DELAY);
  }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1)
  {
  }
}
