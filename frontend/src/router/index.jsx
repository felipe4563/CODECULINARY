import { createBrowserRouter, Navigate } from 'react-router-dom';
import RutaProtegida from './RutaProtegida';
import Layout from '../components/layout/Layout';
import LoginPage from '../pages/auth/LoginPage';
import Dashboard from '../pages/Dashboard';
import VentasPage from '../pages/ventas/VentasPage';
import PedidoPage from '../pages/ventas/PedidoPage';
import ConfiguracionPage from '../pages/configuracion/ConfiguracionPage';
import ProductosPage from '../pages/productos/ProductosPage';
import CajaPage from '../pages/caja/CajaPage';
import RolesPage from '../pages/roles/RolesPage';
import SucursalesPage from '../pages/sucursales/SucursalesPage';
import CajasPage from '../pages/cajas/CajasPage';
import UsuariosPage from '../pages/usuarios/UsuariosPage';
import LibroCajaPage from '../pages/libro-caja/LibroCajaPage';
import InventarioPage from '../pages/inventario/InventarioPage';
import ComprasPage from '../pages/compras/ComprasPage';
import ClientesPage from '../pages/clientes/ClientesPage';
import ReportesPage from '../pages/reportes/ReportesPage';
import CocinaPage from '../pages/cocina/CocinaPage';
import PantallaCocinaImpresion from '../pages/cocina/PantallaCocinaImpresion';
import PerfilPage from '../pages/perfil/PerfilPage';
import CombosPage from '../pages/combos/CombosPage';
import PromocionesPage from '../pages/promociones/PromocionesPage';
import CuponesPage from '../pages/cupones/CuponesPage';
import RuletaPage from '../pages/ruleta/RuletaPage';
import InsumosPage from '../pages/insumos/InsumosPage';
import AutoservicioPage from '../pages/autoservicio/AutoservicioPage';

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    { path: '/m/:codigo', element: <AutoservicioPage /> },
    {
      element: <RutaProtegida />,
      children: [
        {
          element: <Layout />,
          children: [
            { path: '/',                  element: <Dashboard /> },
            { path: '/ventas',            element: <VentasPage /> },
            { path: '/ventas/pedido/:id', element: <PedidoPage /> },
            { path: '/productos',         element: <ProductosPage /> },
            { path: '/combos',            element: <CombosPage /> },
            { path: '/promociones',       element: <PromocionesPage /> },
            { path: '/cupones',           element: <CuponesPage /> },
            { path: '/ruleta',            element: <RuletaPage /> },
            { path: '/configuracion',        element: <Navigate to="/configuracion/negocio" replace /> },
            { path: '/configuracion/:tab',   element: <ConfiguracionPage /> },
            { path: '/caja',             element: <CajaPage /> },
            { path: '/roles',            element: <RolesPage /> },
            { path: '/sucursales',       element: <SucursalesPage /> },
            { path: '/cajas',            element: <CajasPage /> },
            { path: '/usuarios',         element: <UsuariosPage /> },
            { path: '/libro-caja',       element: <LibroCajaPage /> },
            { path: '/inventario',       element: <InventarioPage /> },
            { path: '/compras',          element: <ComprasPage /> },
            { path: '/insumos',          element: <InsumosPage /> },
            { path: '/clientes',         element: <ClientesPage /> },
            { path: '/reportes',         element: <ReportesPage /> },
            { path: '/cocina',           element: <CocinaPage /> },
            { path: '/pantalla-cocina-impresion', element: <PantallaCocinaImpresion /> },
            { path: '/perfil',           element: <PerfilPage /> },
          ],
        },
      ],
    },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  }
);
