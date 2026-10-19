# Migración a SQLite local y cajas por LAN

POSVEN Pro utiliza SQLite como única base de datos operativa. La base reside en el equipo configurado como servidor y se almacena en la carpeta de datos de usuario de Electron.

## Red local

- El servidor Electron escucha en el puerto TCP 9002 sobre las interfaces de red.
- En el primer inicio se elige «Servidor» o «Caja cliente».
- El servidor muestra sus direcciones IPv4; los clientes introducen la IP del servidor.
- Los clientes usan directamente la aplicación servida por el servidor; no abren ni escriben un archivo SQLite compartido por red.
- Si el servidor no está disponible, no se debe simular que una operación fue guardada. Las cajas cliente necesitan conectividad con el servidor para confirmar escrituras.

## Persistencia

El archivo `posven.sqlite` se conserva en la carpeta de datos de usuario de Electron. El adaptador usa SQLite mediante WebAssembly y vuelca las escrituras a un archivo temporal, fuerza la escritura a disco y sustituye el archivo de forma atómica. Deben hacerse respaldos periódicos con la aplicación cerrada.

## Instalación

El flujo de GitHub Actions construye el instalador para Windows. Después de cada cambio de dependencias debe pasar una compilación completa y verificarse el artefacto .exe antes de distribuirlo.
