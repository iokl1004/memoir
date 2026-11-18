# memoir 배포 이미지: React 화면과 Spring Boot를 jar 하나로 묶어 실행해요.
# 서버(Oracle Cloud ARM 등)에서 직접 빌드하면 그 서버의 CPU에 맞는 이미지가 만들어져요.

# 1) 화면 빌드
FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) 서버 jar 빌드 (화면은 1에서 만든 것을 넣어요)
FROM eclipse-temurin:21-jdk AS app
WORKDIR /src
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
# Windows에서 받은 저장소면 gradlew 줄 끝이 CRLF일 수 있어서 맞춰요.
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew --no-daemon dependencies > /dev/null
COPY src src
COPY --from=web /web/dist frontend/dist
RUN ./gradlew --no-daemon bootJar -PskipFrontend

# 3) 실행
FROM eclipse-temurin:21-jre
RUN useradd --system --no-create-home memoir
WORKDIR /app
COPY --from=app /src/build/libs/memoir.jar app.jar
USER memoir
ENV SPRING_PROFILES_ACTIVE=prod
# 작성·수정 시각을 한국 시간으로 저장하고 보여줘요. (서버 기본값은 UTC라 9시간 어긋나요)
ENV TZ=Asia/Seoul
EXPOSE 8080
# 무료 서버는 메모리가 작아서, 컨테이너 메모리의 75%까지만 써요.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-Duser.timezone=Asia/Seoul", "-jar", "app.jar"]
