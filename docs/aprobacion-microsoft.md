# Aprobación de Microsoft para el modo premium

**Aprobada el 30-10-2026** (correo de Mojang Enforcement). Id. de la app: `bf95468d-9abf-41ad-b865-4d7ce7ab2d98` (en
`src/main/microsoft.ts`).

Desde 2022, un launcher nuevo no puede iniciar sesión con cuentas de Microsoft en Minecraft hasta que Mojang aprueba su
"aplicación" de Azure. Sin aprobar, el paso `login_with_xbox` de la API de Minecraft responde **403 "Invalid app
registration"**. Se pide una vez y tarda (revisan las solicitudes cada semana, según guías de terceros). Mientras tanto
el launcher funciona en modo no premium.

## Pasos (los tiene que hacer el dueño, con su cuenta de Microsoft)

1. Entrar en <https://portal.azure.com> con tu cuenta de Microsoft (gratis; si pide crear un "directorio", aceptar).
2. Buscar **"Registros de aplicaciones"** (App registrations) → **Nuevo registro**:
   - Nombre: `Nexos Launcher`.
   - Tipos de cuenta: **"Solo cuentas personales de Microsoft"** (Personal Microsoft accounts only).
   - URI de redirección: plataforma **"Cliente público/nativo (móvil y escritorio)"** con `http://localhost`.
3. En la aplicación creada → **Autenticación** → activar **"Permitir flujos de clientes públicos"** = Sí (si no, sale
   el error AADSTS70002). Guardar.
4. Copiar el **Id. de aplicación (cliente)** de la página "Información general". No es secreto (va dentro del launcher),
   pero no hace falta publicarlo.
5. Rellenar el formulario de revisión de Mojang: <https://aka.ms/mce-reviewappid> con ese Id., el nombre del launcher y
   para qué es (launcher privado para el servidor de un grupo de amigos).
6. Esperar la respuesta por correo. Cuando aprueben, pasar el Id. para el Sprint 4.

## Plan B

Si no lo aprueban: los jugadores premium entran como no premium con su nombre y se registran con `/register` en el
servidor (MixAuth). Funciona igual; solo pierden el reconocimiento automático de su cuenta premium.
