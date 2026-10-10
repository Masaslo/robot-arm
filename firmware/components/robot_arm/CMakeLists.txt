idf_component_register(SRCS "robot_arm.c"
                       INCLUDE_DIRS "include"
                       REQUIRES pca9685 esp_driver_i2c freertos log)
