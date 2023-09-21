FROM gradle:8.3.0-jdk20-alpine as builder

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

RUN gradle build

FROM openjdk:20-jdk-buster

COPY --from=builder /app/build/libs/app.jar /app/

EXPOSE 8080

CMD ["java", "-jar", "/app/app.jar"]
