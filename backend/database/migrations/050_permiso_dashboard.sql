-- backend/database/migrations/050_permiso_dashboard.sql
-- El Dashboard hasta ahora era visible para CUALQUIER usuario logueado
-- (ver Sidebar.jsx, item marcado `siempre: true`, sin permiso que lo
-- condicione). Se agrega un permiso propio para poder ocultarlo por rol.
-- Se asigna a TODOS los roles existentes en el momento de la migración
-- para no cambiar el comportamiento actual de nadie — el administrador
-- puede después sacárselo a los roles que no lo necesiten desde la
-- pantalla de Roles.
INSERT INTO permisos (modulo, accion, descripcion) VALUES
  ('dashboard', 'ver', 'Ver el dashboard');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p
WHERE p.modulo = 'dashboard' AND p.accion = 'ver';
