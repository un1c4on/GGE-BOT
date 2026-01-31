import './App.css'
import * as React from 'react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { 
    Box, Drawer, AppBar, Toolbar, List, Typography, Divider, 
    ListItem, ListItemButton, ListItemIcon, ListItemText, CssBaseline,
    Avatar, Chip, Collapse, IconButton, Menu, MenuItem, Checkbox, Button
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import ExtensionIcon from '@mui/icons-material/Extension'
import LanguageIcon from '@mui/icons-material/Language'

import GGEUserTable from './modules/GGEUsersTable'
import UserSettings from './modules/userSettings'
import { ErrorType, ActionType, User } from "./types.js"
import { getTranslation } from './translations.js'
import ReconnectingWebSocket from "reconnecting-websocket"

const drawerWidth = 350;

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#90caf9' },
    background: { default: '#050c1a', paper: '#0a1929' }
  },
  typography: { fontFamily: 'Inter, sans-serif' }
})

function App() {
  const [activeView, setActiveView] = React.useState('dashboard');
  const [settingsTab, setSettingsTab] = React.useState('account');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState(null);
  const [users, setUsers] = React.useState([])
  const [usersStatus, setUsersStatus] = React.useState({})
  const [plugins, setPlugins] = React.useState([])
  const [language, setLanguage] = React.useState(localStorage.getItem('lang') || 'tr');
  const [anchorEl, setAnchorEl] = React.useState(null);

  const t = (key) => getTranslation(language, key);

  let ws = React.useMemo(() => {
    const ws = new ReconnectingWebSocket(`${window.location.protocol === 'https:' ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`,[], {WebSocket: WebSocket, minReconnectionDelay: 3000 })
    ws.onmessage = (msg) => {
      let [err, action, obj] = JSON.parse(msg.data.toString())
      if (action === ActionType.GetUsers && err === ErrorType.Success) {
        const uList = obj[0].map(e => new User(e));
        setUsers(uList); setPlugins(obj[1]);
        if (uList.length > 0 && !selectedUser) setSelectedUser(uList[0]);
      } else if (action === ActionType.StatusUser) {
        console.debug("Live Status Received:", obj);
        setUsersStatus(prev => ({ ...prev, [obj.id]: obj }));
      } else if (action === ActionType.GetUUID && err === ErrorType.Unauthenticated) {
        window.location.href = "signin.html";
      }
    }
    return ws
  }, [selectedUser])

  const handleLangMenu = (event) => setAnchorEl(event.currentTarget);
  const handleLangSelect = (lang) => { setLanguage(lang); localStorage.setItem('lang', lang); setAnchorEl(null); };

  const handleBotSelect = (user) => {
    setSelectedUser(user); setActiveView('settings'); setSettingsOpen(true); setSettingsTab('account');
  };

  const togglePluginFromSidebar = (e, pluginKey) => {
      e.stopPropagation();
      if (!selectedUser) return;
      
      const updatedUser = { ...selectedUser };
      updatedUser.plugins = JSON.parse(JSON.stringify(updatedUser.plugins || {}));
      
      const currentState = updatedUser.plugins[pluginKey]?.state || false;
      
      if (!updatedUser.plugins[pluginKey]) updatedUser.plugins[pluginKey] = {};
      updatedUser.plugins[pluginKey].state = !currentState;
      
      // Update Selected User State
      setSelectedUser(updatedUser);
      
      // Update Users List State (for Dashboard reflection)
      setUsers(prevUsers => prevUsers.map(u => u.id === updatedUser.id ? updatedUser : u));
  };

  const handleSidebarSave = () => {
      if (!selectedUser) return;
      ws.send(JSON.stringify([ErrorType.Success, ActionType.SetUser, selectedUser]));
      // Optional: Show success feedback
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <Box sx={{ display: 'flex' }}>
        <CssBaseline />
        <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: 'rgba(10, 25, 41, 0.8)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <Toolbar>
            <SmartToyIcon sx={{ mr: 2, color: '#90caf9' }} />
            <Typography variant="h6" noWrap sx={{ flexGrow: 1, fontWeight: 'bold', letterSpacing: 1 }}>GGE-BOT SAAS</Typography>
            
            {/* DİL SEÇİCİ */}
            <IconButton onClick={handleLangMenu} sx={{ mr: 2, color: '#90caf9' }}>
              <LanguageIcon />
              <Typography variant="button" sx={{ ml: 1, fontWeight: 'bold' }}>{language.toUpperCase()}</Typography>
            </IconButton>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
              <MenuItem onClick={() => handleLangSelect('tr')}>Türkçe</MenuItem>
              <MenuItem onClick={() => handleLangSelect('en')}>English</MenuItem>
            </Menu>

            <Chip label="v2.0 Beta" size="small" color="primary" sx={{ mr: 2, borderRadius: 1 }} />
            <Avatar sx={{ bgcolor: '#90caf9', color: '#000', width: 32, height: 32 }}>{selectedUser?.name?.[0]?.toUpperCase() || 'U'}</Avatar>
          </Toolbar>
        </AppBar>

        <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box', borderRight: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column' } }}>
          <Toolbar />
          <Box sx={{ overflow: 'auto', mt: 2, flexGrow: 1 }}>
            <List sx={{ px: 1 }}>
              <ListItem disablePadding sx={{ mb: 1 }}>
                <ListItemButton selected={activeView === 'dashboard'} onClick={() => { setActiveView('dashboard'); setSettingsOpen(false); }} sx={{ borderRadius: 2 }}>
                  <ListItemIcon><DashboardIcon color={activeView === 'dashboard' ? 'primary' : 'inherit'} /></ListItemIcon>
                  <ListItemText primary={t("Dashboard")} />
                </ListItemButton>
              </ListItem>

              {/* Bot Ayarları Sadece Bot Varsa Görünür */}
              {selectedUser && (
                <>
                  <ListItem disablePadding>
                    <ListItemButton onClick={() => setSettingsOpen(!settingsOpen)} sx={{ borderRadius: 2 }}>
                      <ListItemIcon><SettingsIcon color={activeView === 'settings' ? 'primary' : 'inherit'} /></ListItemIcon>
                      <ListItemText primary={t("Bot Settings")} secondary={selectedUser.name} />
                      {settingsOpen ? <ExpandLess /> : <ExpandMore />}
                    </ListItemButton>
                  </ListItem>

                  <Collapse in={settingsOpen} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding sx={{ pl: 2 }}>
                      <ListItemButton selected={activeView === 'settings' && settingsTab === 'account'} onClick={() => { setActiveView('settings'); setSettingsTab('account'); }} sx={{ borderRadius: '10px 0 0 10px', mt: 0.5 }}>
                        <ListItemIcon><AccountCircleIcon sx={{ fontSize: 20 }} /></ListItemIcon>
                        <ListItemText primary={t("Account Details")} primaryTypographyProps={{ fontSize: '0.85rem' }} />
                      </ListItemButton>
                      
                      <Divider sx={{ my: 1, mx: 2, opacity: 0.1 }} />
                      <Typography variant="caption" sx={{ px: 2, color: 'gray', fontWeight: 'bold' }}>{t("ACTIVE PLUGINS")}</Typography>
                      
                      {plugins.map((plugin) => (
                        <ListItemButton 
                            key={plugin.key} 
                            selected={activeView === 'settings' && settingsTab === plugin.key} 
                            onClick={() => { setActiveView('settings'); setSettingsTab(plugin.key); }} 
                            sx={{ borderRadius: '10px 0 0 10px', borderLeft: selectedUser?.plugins[plugin.key]?.state ? '3px solid #4caf50' : '3px solid transparent' }}
                        >
                          <Checkbox 
                             size="small" 
                             checked={selectedUser?.plugins[plugin.key]?.state || false} 
                             onClick={(e) => togglePluginFromSidebar(e, plugin.key)}
                             sx={{ p: 0.5, mr: 1, color: '#666', '&.Mui-checked': { color: '#4caf50' } }}
                          />
                          <ListItemIcon sx={{ minWidth: 30 }}><ExtensionIcon sx={{ fontSize: 18, color: selectedUser?.plugins[plugin.key]?.state ? '#4caf50' : 'inherit' }} /></ListItemIcon>
                          <ListItemText primary={t(plugin.name)} primaryTypographyProps={{ fontSize: '0.8rem' }} />
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </>
              )}
                        </List>
          </Box>
            
          {/* SIDEBAR FOOTER ACTION */}
          {selectedUser && (
              <Box sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.05)', bgcolor: 'rgba(0,0,0,0.2)' }}>
                  <Button 
                      fullWidth 
                      variant="contained" 
                      color="primary" 
                      onClick={handleSidebarSave}
                      sx={{ fontWeight: 'bold' }}
                  >
                      {t("Save Changes")}
                  </Button>
              </Box>
          )}

          <Box sx={{ px: 1, pb: 2 }}>
            <Divider sx={{ mb: 1, opacity: 0.1 }} />
            <ListItem disablePadding>
              <ListItemButton 
                onClick={() => window.location.href = "signin.html"} 
                sx={{ 
                    borderRadius: 2,
                    '&:hover': { bgcolor: 'rgba(211, 47, 47, 0.1)' }
                }}
              >
                <ListItemIcon><LogoutIcon sx={{ color: '#ff5252' }} /></ListItemIcon>
                <ListItemText 
                    primary={t("Logout")} 
                    primaryTypographyProps={{ sx: { color: '#ff5252', fontWeight: 'bold' } }} 
                />
              </ListItemButton>
            </ListItem>
          </Box>
        </Drawer>
            

        <Box component="main" sx={{ flexGrow: 1, p: 4, minHeight: '100vh', bgcolor: '#050c1a' }}>
          <Toolbar />
          {activeView === 'dashboard' ? (
            <GGEUserTable ws={ws} plugins={plugins} rows={users} usersStatus={usersStatus} language={language} onSelectUser={handleBotSelect} />
          ) : (
            <UserSettings 
                ws={ws} 
                selectedUser={selectedUser} 
                userStatus={usersStatus[selectedUser?.id]} // Canlı statü (Envanter burada)
                plugins={plugins} 
                language={language} 
                activeTab={settingsTab} 
            />
          )}
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
