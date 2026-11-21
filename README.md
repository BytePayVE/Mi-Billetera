# Pagobyte – App Móvil de Clientes (Flutter / Dart)

Aplicación móvil exclusiva para los clientes de **Pagobyte**, conectada directamente a tu base de datos en **Supabase** (`huqyycvdakrlfvqugvvp.supabase.co`).

## Estructura del proyecto
- `lib/main.dart`: Inicialización de Supabase y control de sesión.
- `lib/core/config.dart`: Credenciales públicas de Supabase, cálculo de mora ($5 a los 2 días + $5 semanal) y formateadores USD/Bs.
- `lib/core/theme.dart`: Paleta tecnológica oficial de Pagobyte (`#0B1020`, `#2447F5`, `#19D5FF`, `#F3F5FA`).
- `lib/core/terms_data.dart`: Términos y condiciones completos (`v3-2026-11`).
- `lib/services/supabase_service.dart`: Consultas, RPCs (`solicitar_producto`, `aceptar_compra`, `reportar_pago`) y subida de comprobantes al bucket `comprobantes`.
- `lib/screens/`: Pantallas exclusivas de clientes (`auth_screen.dart`, `home_shell.dart`, `inicio_tab.dart`, `tienda_tab.dart`, `cuotas_tab.dart`, `perfil_tab.dart`).

## Cómo ejecutar
1. Crea un proyecto Flutter o copia la carpeta `lib/` y `pubspec.yaml` dentro de tu proyecto:
   ```bash
   flutter pub get
   flutter run
   ```
