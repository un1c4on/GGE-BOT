import './App.css'
import * as React from 'react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import {
  Box, Drawer, AppBar, Toolbar, List, Typography, Divider,
  ListItem, ListItemButton, ListItemIcon, ListItemText, CssBaseline,
  Avatar, Chip, Collapse, IconButton, Menu, MenuItem, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button,
  Select, FormControl, InputLabel, Alert, CircularProgress
} from '@mui/material'
import CastleIcon from '@mui/icons-material/Castle'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import ExtensionIcon from '@mui/icons-material/Extension'
import LanguageIcon from '@mui/icons-material/Language'
import GpsFixedIcon from '@mui/icons-material/GpsFixed'

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

  // Credential Verification States
  const [credentialError, setCredentialError] = React.useState('');
  const [credentialVerifying, setCredentialVerifying] = React.useState(false);

  // Castle Setup Modal States
  const [showCastleModal, setShowCastleModal] = React.useState(false);
  const [castleStatus, setCastleStatus] = React.useState(null);
  const [castleForm, setCastleForm] = React.useState({ server: '', username: '', password: '' });
  const [castleError, setCastleError] = React.useState('');
  const [castleLoading, setCastleLoading] = React.useState(false);
  const [instances, setInstances] = React.useState([]);
  const [langData, setLangData] = React.useState({});

  const t = (key) => getTranslation(language, key);

  let ws = React.useMemo(() => {
    const ws = new ReconnectingWebSocket(`${window.location.protocol === 'https:' ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`, [], { WebSocket: WebSocket, minReconnectionDelay: 3000 })
    ws.onmessage = (msg) => {
      let [err, action, obj] = JSON.parse(msg.data.toString())
      if (action === ActionType.GetUsers && err === ErrorType.Success) {
        console.log("Loaded Plugins:", obj[1]);
        const uList = obj[0].map(e => new User(e));
        setUsers(uList); setPlugins(obj[1]);
        if (uList.length > 0 && !selectedUser) setSelectedUser(uList[0]);
        // Kayıt başarılı - doğrulama durumunu temizle
        setCredentialVerifying(false);
        setCredentialError('');
      } else if (action === ActionType.SetUser) {
        if (err !== ErrorType.Success) {
          // Doğrulama başarısız
          setCredentialVerifying(false);
          setCredentialError(obj?.error || 'Doğrulama başarısız');
        } else if (obj?.verifying) {
          // Doğrulama devam ediyor
          setCredentialVerifying(true);
          setCredentialError('');
        }
      } else if (action === ActionType.StatusUser) {
        console.debug("Live Status Received:", obj);
        setUsersStatus(prev => ({ ...prev, [obj.id]: obj }));
      } else if (action === ActionType.GetUUID && err === ErrorType.Unauthenticated) {
        window.location.href = "signin.html";
      } else if (action === ActionType.GetCastleStatus) {
        setCastleStatus(obj);
        // Kale yoksa veya kilitli değilse modal göster
        if (!obj.hasCastle || !obj.isLocked) {
          setShowCastleModal(true);
        }
      } else if (action === ActionType.VerifyCastle) {
        setCastleLoading(false);
        if (err === ErrorType.Success && obj.success) {
          setShowCastleModal(false);
          setCastleError('');
          // Kullanıcı listesini yenile
          ws.send(JSON.stringify([ErrorType.Success, ActionType.GetUsers, {}]));
        } else {
          setCastleError(obj.error || 'Bir hata oluştu');
        }
      }
    }
    // Bağlantı açıldığında kale durumunu kontrol et
    ws.onopen = () => {
      ws.send(JSON.stringify([ErrorType.Success, ActionType.GetCastleStatus, {}]));
    }
    return ws
  }, [selectedUser])

  // Sunucu listesini yükle
  React.useEffect(() => {
    const fetchInstances = async () => {
      try {
        const protocol = window.location.protocol === 'https:' ? "https" : "http";
        const host = `${protocol}://${window.location.hostname}:${window.location.port}`;
        const langRes = await fetch(`${host}/lang.json`);
        setLangData(await langRes.json());
        const xmlRes = await fetch(`${host}/1.xml`);
        const xmlDoc = new DOMParser().parseFromString(await xmlRes.text(), "text/xml");
        const _instances = xmlDoc.getElementsByTagName("instance");
        const loadedInstances = [];
        for (let i = 0; i < _instances.length; i++) {
          const obj = _instances[i];
          let sName, locaId, iName;
          for (let j = 0; j < obj.childNodes.length; j++) {
            const c = obj.childNodes[j];
            if (c.nodeName === "server") sName = c.textContent;
            if (c.nodeName === "instanceLocaId") locaId = c.textContent;
            if (c.nodeName === "instanceName") iName = c.textContent;
          }
          if (locaId) loadedInstances.push({ id: obj.getAttribute("value"), server: sName, instanceLocaId: locaId, instanceName: iName });
        }
        setInstances(loadedInstances);
        if (loadedInstances.length > 0 && !castleForm.server) {
          setCastleForm(prev => ({ ...prev, server: loadedInstances[0].id }));
        }
      } catch (error) { console.error(error); }
    };
    fetchInstances();
  }, []);

  const handleCastleSubmit = () => {
    if (!castleForm.server || !castleForm.username || !castleForm.password) {
      setCastleError('Tüm alanları doldurun');
      return;
    }
    setCastleLoading(true);
    setCastleError('');
    ws.send(JSON.stringify([ErrorType.Success, ActionType.VerifyCastle, castleForm]));
  };

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

    // Auto-save: Immediately send to server
    ws.send(JSON.stringify([ErrorType.Success, ActionType.SetUser, updatedUser]));
  };

  return (
    <ThemeProvider theme={darkTheme}>
      {/* Kale Kurulum Modal */}
      <Dialog
        open={showCastleModal}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { bgcolor: '#0a1929', border: '1px solid rgba(144, 202, 249, 0.3)' }
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <CastleIcon sx={{ color: '#90caf9' }} />
          <Typography variant="h6">{t("Kale Bağlantısı")}</Typography>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <Alert severity="warning" sx={{ mb: 3 }}>
            {t("Bu işlem tek seferlik! Kale atandıktan sonra değiştirilemez.")}
          </Alert>

          {castleError && (
            <Alert severity="error" sx={{ mb: 2 }}>{castleError}</Alert>
          )}

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>{t("Sunucu")}</InputLabel>
            <Select
              value={castleForm.server}
              onChange={(e) => setCastleForm(prev => ({ ...prev, server: e.target.value }))}
              label={t("Sunucu")}
            >
              {instances.map((inst, i) => (
                <MenuItem value={inst.id} key={i}>
                  {(langData[inst.instanceLocaId] || inst.instanceLocaId) + ' ' + inst.instanceName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            label={t("Oyun Kullanıcı Adı")}
            value={castleForm.username}
            onChange={(e) => setCastleForm(prev => ({ ...prev, username: e.target.value }))}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            label={t("Oyun Şifresi")}
            type="password"
            value={castleForm.password}
            onChange={(e) => setCastleForm(prev => ({ ...prev, password: e.target.value }))}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <Button
            variant="contained"
            onClick={handleCastleSubmit}
            disabled={castleLoading}
            startIcon={castleLoading ? <CircularProgress size={20} /> : <CastleIcon />}
            sx={{ px: 4 }}
          >
            {castleLoading ? t("Doğrulanıyor...") : t("Kaydet ve Kilitle")}
          </Button>
        </DialogActions>
      </Dialog>

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

                      <ListItemButton selected={activeView === 'settings' && settingsTab === 'attack'} onClick={() => { setActiveView('settings'); setSettingsTab('attack'); }} sx={{ borderRadius: '10px 0 0 10px', mt: 0.5, bgcolor: 'rgba(144, 202, 249, 0.08)' }}>
                        <ListItemIcon><GpsFixedIcon sx={{ fontSize: 20, color: '#ff9800' }} /></ListItemIcon>
                        <ListItemText primary={t("SALDIRI AYARLARI")} primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#ff9800' }} />
                      </ListItemButton>

                      <Divider sx={{ my: 1, mx: 2, opacity: 0.1 }} />
                      <Typography variant="caption" sx={{ px: 2, color: 'gray', fontWeight: 'bold' }}>{t("ACTIVE PLUGINS")}</Typography>

                      {plugins.filter(p => p.key !== 'presets' && p.key !== 'attack').map((plugin) => (
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
              userStatus={usersStatus[selectedUser?.id]}
              plugins={plugins}
              language={language}
              activeTab={settingsTab}
              credentialError={credentialError}
              credentialVerifying={credentialVerifying}
              clearCredentialError={() => setCredentialError('')}
            />
          )}
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App
