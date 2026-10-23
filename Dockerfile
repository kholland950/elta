FROM gradle:9.8.2-jdk25 AS builder

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

RUN gradle build

FROM eclipse-temurin:25-jre

COPY --from=builder /app/build/libs/app.jar /app/

EXPOSE 8080

CMD ["java", "-jar", "/app/app.jar"]
