# PCA9685 Driver

Source code for the PCA9685 I2C PWM driver for ESP-IDF.

## Note
This driver is optimized and thought for PWM servomotor control, not LED control.

(only LED_OFF register control, and default frequency is set to 50Hz)

## Introduction

This driver implements communications with the PCA9685 using the new i2c esp-idf driver (`driver/i2c_master.h`).

It is used to communicate with the PCA9685 controller using the ESP-IDF framework I2C master driver.

> [!NOTE]
Interrupts are not yet supported!

## Installation

To install the driver, you can clone the repository and place it in the `components` folder of your project.

```bash
git clone https://github.com/TNY-Robotics/pca9685-esp-idf.git components/pca9685
```

## Usage

The driver exposes a simple header file named `pca9685.h`, that you can include using :

```c
#include "pca9685.h"
```

## Examples

An example of how to create, configure, read and delete an pca9685 object using the PCA9685 driver can be found in the `examples` folder.

## Licence

This driver is under the MIT Licence.

## Author

This driver was created by the [TNY Robotics](https://tny-robotics.com) team.

For any questions or suggestions, please contact us at [contact@tny-robotics.com](mailto:contact@tny-robotics.com).
