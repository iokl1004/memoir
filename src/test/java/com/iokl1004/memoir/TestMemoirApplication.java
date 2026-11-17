package com.iokl1004.memoir;

import org.springframework.boot.SpringApplication;

public class TestMemoirApplication {

	public static void main(String[] args) {
		SpringApplication.from(MemoirApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
