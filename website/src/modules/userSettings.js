import * as React from 'react'
import {
    Checkbox, TextField, Paper, FormControlLabel,
    Select, MenuItem, FormControl, InputLabel, Box, Typography,
    CircularProgress, Divider, Fab, Zoom, Button, Backdrop
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'

import { ErrorType, ActionType } from "../types.js"
import PluginsTable from './pluginsTable'
import { getTranslation } from '../translations.js'

export default function UserSettings(props) {
    const { language, activeTab } = props;
    const t = (key) => getTranslation(language, key);

    const [loading, setLoading] = React.useState(true);
    const [instances, setInstances] = React.useState([]);
    const [langData, setLangData] = React.useState({});

    // Form states
    const [name, setName] = React.useState(props.selectedUser.name ?? "");
    const [pass, setPass] = React.useState("");
    const [plugins, setPlugins] = React.useState(props.selectedUser.plugins || {});
    const [server, setServer] = React.useState(props.selectedUser.server || "");
    const [externalEvent, setExternalEvent] = React.useState(props.selectedUser.externalEvent);

    const isNewUser = !props.selectedUser.id;

    // Smart Save State
    const [hasChanges, setHasChanges] = React.useState(false);
    const [justSaved, setJustSaved] = React.useState(false);

    React.useEffect(() => {
        const fetchData = async () => {
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
                if (!props.selectedUser.server && loadedInstances.length > 0) setServer(loadedInstances[0].id);
                setLoading(false);
            } catch (error) { console.error(error); setLoading(false); }
        };
        fetchData();
    }, [props.selectedUser.server]);

    // Sync plugins state when selectedUser.plugins changes (from sidebar toggle)
    React.useEffect(() => {
        setPlugins(props.selectedUser.plugins || {});
    }, [props.selectedUser.plugins]);

    const handleSave = () => {
        const activePlugins = {};
        Object.entries(plugins).forEach(([key, val]) => {
            const hasSettings = Object.keys(val).filter(k => k !== 'state' && k !== 'filename').length > 0;
            if (val && (val.state === true || hasSettings)) activePlugins[key] = val;
        });
        let obj = { id: props.selectedUser.id, name, pass, server, plugins: activePlugins, externalEvent };
        if (!isNewUser && pass === "") obj.pass = props.selectedUser.pass;
        props.ws.send(JSON.stringify([ErrorType.Success, isNewUser ? ActionType.AddUser : ActionType.SetUser, obj]));

        // Visual feedback
        setHasChanges(false);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
    };

    // Track changes
    React.useEffect(() => {
        setHasChanges(true);
    }, [plugins, name, pass, server, externalEvent]);

    if (loading) return (
        <Box sx={{ p: 5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <CircularProgress />
            <Typography sx={{ mt: 2 }}>{t("Loading settings...")}</Typography>
        </Box>
    );

    return (
        <Box sx={{ position: 'relative', minHeight: '80vh', pb: 10 }}>
            {activeTab === 'account' ? (
                <Box>
                    <Typography variant="h4" sx={{ mb: 4, fontWeight: 'bold' }}>{t("Account Settings")}</Typography>
                    <Paper sx={{ p: 4, bgcolor: '#0a1929', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                            <TextField
                                fullWidth
                                label={t("Username")}
                                value={name}
                                disabled={true}
                                variant="outlined"
                                helperText={t("Kullanıcı adı değiştirilemez")}
                            />
                            <TextField
                                fullWidth
                                label={t("Password")}
                                type='password'
                                value={pass}
                                onChange={e => setPass(e.target.value)}
                                variant="outlined"
                                helperText={t("Oyun şifrenizi değiştirdiyseniz buradan güncelleyin")}
                            />
                            <FormControl fullWidth>
                                <InputLabel>{t("Server")}</InputLabel>
                                <Select value={server} label={t("Server")} onChange={e => setServer(e.target.value)}>
                                    {instances.map((inst, i) => (
                                        <MenuItem value={inst.id} key={i}>{(langData[inst.instanceLocaId] || inst.instanceLocaId) + ' ' + inst.instanceName}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControlLabel control={<Checkbox checked={externalEvent} onChange={e => setExternalEvent(e.target.checked)} />} label={t("External Event (OR/BTH)")} />
                        </Box>
                    </Paper>
                </Box>
            ) : activeTab === 'attack' ? (
                <Box>
                    {props.plugins.filter(p => p.key === 'attack').map(plugin => (
                        <Box key={plugin.key}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#ff9800' }}>{t("SALDIRI AYARLARI")}</Typography>
                                    <Typography color="gray" variant="body1">{t("Saldiri gecikme, limit ve flank ayarlari")}</Typography>
                                </Box>
                            </Box>
                            <Divider sx={{ mb: 4, opacity: 0.1 }} />

                            {/* Gunluk Saldiri Sayaci */}
                            <Paper sx={{ p: 3, mb: 4, bgcolor: 'rgba(255, 152, 0, 0.1)', border: '1px solid #ff9800', borderRadius: 2 }}>
                                <Typography variant="h6" sx={{ color: '#ff9800', mb: 1 }}>{t("Gunluk Saldiri Sayaci")}</Typography>
                                <Typography variant="h3" sx={{ fontWeight: 'bold' }}>
                                    {props.userStatus?.attackStats?.currentHits || 0}
                                </Typography>
                                <Typography variant="caption" color="gray">{t("Sifirlama: Her gun 02:00 (CET 00:00)")}</Typography>
                            </Paper>

                            {/* Attack Settings */}
                            <Box sx={{ bgcolor: 'rgba(255,255,255,0.02)', p: 4, borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
                                <PluginsTable singlePlugin={plugin} plugins={[plugin]} userPlugins={plugins} onChange={e => setPlugins(e)} language={language} />
                            </Box>
                        </Box>
                    ))}
                </Box>
            ) : (
                <Box>
                    {props.plugins.filter(p => p.key === activeTab && p.key !== 'presets' && p.key !== 'attack').map(plugin => (
                        <Box key={plugin.key}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
                                <Box>
                                    <Typography variant="h4" sx={{ fontWeight: 'bold' }}>{t(plugin.name)}</Typography>
                                    <Typography color="gray" variant="body1">{t(plugin.description)}</Typography>
                                </Box>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={plugins[plugin.key]?.state || false}
                                            onChange={e => {
                                                const np = { ...plugins };
                                                np[plugin.key] = { ...np[plugin.key], state: e.target.checked };
                                                setPlugins(np);
                                            }}
                                            color="success"
                                            sx={{ '& .MuiSvgIcon-root': { fontSize: 40 } }}
                                        />
                                    }
                                    label={plugins[plugin.key]?.state ? t("ENABLED") : t("DISABLED")}
                                    sx={{
                                        bgcolor: plugins[plugin.key]?.state ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255,255,255,0.05)',
                                        px: 3, py: 1.5, borderRadius: 3, border: '1px solid',
                                        borderColor: plugins[plugin.key]?.state ? '#4caf50' : '#333'
                                    }}
                                />
                            </Box>
                            <Divider sx={{ mb: 4, opacity: 0.1 }} />

                            {/* Plugin Specific Settings */}
                            <Box sx={{ bgcolor: 'rgba(255,255,255,0.02)', p: 4, borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
                                <PluginsTable singlePlugin={plugin} plugins={[plugin]} userPlugins={plugins} onChange={e => setPlugins(e)} language={language} />
                            </Box>
                        </Box>
                    ))}
                </Box>
            )}

            {/* SMART SAVE BUTTON - Only in Settings */}
            <Zoom in={true}>
                <Fab
                    color={justSaved ? "success" : hasChanges ? "warning" : "primary"}
                    variant="extended"
                    onClick={handleSave}
                    disabled={!hasChanges && !justSaved}
                    sx={{
                        position: 'fixed',
                        bottom: 40,
                        right: 40,
                        px: 4,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                        background: justSaved
                            ? 'linear-gradient(45deg, #4caf50 30%, #66bb6a 90%)'
                            : hasChanges
                                ? 'linear-gradient(45deg, #ff9800 30%, #ffa726 90%)'
                                : 'linear-gradient(45deg, #2196f3 30%, #21cbf3 90%)',
                        color: 'white',
                        '&:hover': {
                            transform: hasChanges ? 'translateY(-2px)' : 'none',
                            boxShadow: hasChanges ? '0 12px 40px rgba(0,0,0,0.6)' : '0 8px 32px rgba(0,0,0,0.5)',
                        },
                        '&.Mui-disabled': {
                            background: 'linear-gradient(45deg, #424242 30%, #616161 90%)',
                            color: 'rgba(255,255,255,0.5)'
                        }
                    }}
                >
                    {justSaved ? <CheckCircleIcon sx={{ mr: 1 }} /> : <SaveIcon sx={{ mr: 1 }} />}
                    {justSaved ? t("Saved!") : hasChanges ? t("Save Changes") : t("No Changes")}
                </Fab>
            </Zoom>
        </Box>
    );
}