package com.iokl1004.memoir;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableAsync
public class MemoirApplication {

	public static void main(String[] args) {
		SpringApplication.run(MemoirApplication.class, args);
	}

}
