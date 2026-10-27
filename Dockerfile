# syntax=docker/dockerfile:1

# ---- 1. Build the web UI ---------------------------------------------------
# Vite writes to ../src/FlowPilot.Server/wwwroot, so keep the repo layout:
# web/ lives at /src/web and the output lands in /src/src/FlowPilot.Server/wwwroot.
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY web/ ./
RUN npm run build

# ---- 2. Build and publish the server --------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
COPY --from=web /src/src/FlowPilot.Server/wwwroot ./src/FlowPilot.Server/wwwroot
RUN dotnet restore src/FlowPilot.Server/FlowPilot.Server.csproj
RUN dotnet publish src/FlowPilot.Server/FlowPilot.Server.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false

# ---- 3. Runtime -------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:5080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true \
    FlowPilot__Database__Provider=sqlite \
    ConnectionStrings__FlowPilot="Data Source=/data/flowpilot.db" \
    FlowPilot__PluginsPath=/app/plugins \
    FlowPilot__Http__BlockPrivateNetworks=true

COPY --from=build /app/publish ./

# The aspnet image ships a non-root "app" user ($APP_UID).
RUN mkdir -p /data /app/plugins \
    && chown -R "$APP_UID":"$APP_UID" /data /app/plugins

USER $APP_UID

VOLUME ["/data"]
EXPOSE 5080

ENTRYPOINT ["dotnet", "FlowPilot.Server.dll"]
