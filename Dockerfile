FROM gradle:6.7-jdk11-openj9 as builder

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

RUN gradle build

FROM openjdk:12-jdk-alpine

COPY --from=builder /app/build/libs/app.jar /app/

EXPOSE 8080

CMD ["java", "-jar", "/app/app.jar"]
