import * as React from 'react'
import Checkbox from '@mui/material/Checkbox'
import TextField from '@mui/material/TextField'
import Paper from '@mui/material/Paper'
import Button from '@mui/material/Button'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'

import { ErrorType, ActionType } from "../types.js"
import PluginsTable from './pluginsTable'
import { getTranslation } from '../translations.js'

export default function UserSettings(props) {
    const { language } = props;
    const t = (key) => getTranslation(language, key);

    const [loading, setLoading] = React.useState(true);
    const [instances, setInstances] = React.useState([]);
    const [langData, setLangData] = React.useState({});
    
    // Form states
    const [name, setName] = React.useState(props.selectedUser.name ?? "");
    const [pass, setPass] = React.useState("");
    const [plugins, setPlugins] = React.useState(props.selectedUser.plugins);
    const [server, setServer] = React.useState(props.selectedUser.server || "");
    const [externalEvent, setExternalEvent] = React.useState(props.selectedUser.externalEvent);

    const isNewUser = props.selectedUser.name === "" || !props.selectedUser.name;

    React.useEffect(() => {
        const fetchData = async () => {
            try {
                const protocol = window.location.protocol === 'https:' ? "https" : "http";
                const host = `${protocol}://${window.location.hostname}:${window.location.port}`;
                
                // Fetch lang.json
                const langRes = await fetch(`${host}/lang.json`);
                const langJson = await langRes.json();
                setLangData(langJson);

                // Fetch 1.xml
                const xmlRes = await fetch(`${host}/1.xml`);
                const xmlText = await xmlRes.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, "text/xml");
                
                const _instances = xmlDoc.getElementsByTagName("instance");
                const loadedInstances = [];

                for (let i = 0; i < _instances.length; i++) {
                    const obj = _instances[i];
                    let serverName, zone, instanceLocaId, instanceName;

                    for (let j = 0; j < obj.childNodes.length; j++) {
                        const child = obj.childNodes[j];
                        if (child.nodeName === "server") serverName = child.textContent;
                        if (child.nodeName === "zone") zone = child.textContent;
                        if (child.nodeName === "instanceLocaId") instanceLocaId = child.textContent;
                        if (child.nodeName === "instanceName") instanceName = child.textContent;
                    }

                    if (instanceLocaId) {
                        loadedInstances.push({
                            id: obj.getAttribute("value"),
                            server: serverName,
                            zone,
                            instanceLocaId,
                            instanceName
                        });
                    }
                }
                setInstances(loadedInstances);
                
                // If it's a new user and server isn't set, default to first instance
                if ((!props.selectedUser.server || props.selectedUser.server === "") && loadedInstances.length > 0) {
                    setServer(loadedInstances[0].id);
                }

                setLoading(false);
            } catch (error) {
                console.error("Failed to load settings data:", error);
                setLoading(false);
            }
        };

        fetchData();
    }, [props.selectedUser.server]);

    const pluginTable = React.useMemo(() => {
        return <PluginsTable plugins={props.plugins} userPlugins={plugins} channels={props.channels} 
                    onChange={e => setPlugins(e)} language={language} />
    }, [props.channels, props.plugins, plugins, language]);

    if (loading) {
        return (
            <div onClick={event => event.stopPropagation()} style={{ padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#333', color: '#fff' }}>
                <CircularProgress color="inherit" />
                <Typography sx={{ ml: 2 }}>Loading settings...</Typography>
            </div>
        );
    }

    return (
        <div onClick={event => event.stopPropagation()} style={{ maxWidth: '90vw', width: '800px' }}>
            <Paper sx={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Box sx={{ p: 2, flexGrow: 1, overflowY: 'auto' }}>
                    <FormGroup row={true} sx={{ mb: 2, gap: 2, display: 'flex', alignItems: 'center' }}>
                        <TextField required size="small" label={t("Username")} value={name} onChange={e => setName(e.target.value)} disabled={!isNewUser} />
                        <TextField required size="small" label={t("Password")} type='password' value={pass} onChange={e => setPass(e.target.value)} />
                        
                        <FormControl size="small" style={{width: "150px"}}>
                            <InputLabel id="simple-select-label">{t("Server")}</InputLabel>
                            <Select
                                labelId="simple-select-label"
                                id="simple-select"
                                value={server}
                                onChange={(newValue) => setServer(newValue.target.value)}
                            >
                                {
                                    instances.map((inst, i) => (
                                        <MenuItem value={inst.id} key={`Server${i}`}>
                                            {(langData[inst.instanceLocaId] || inst.instanceLocaId) + ' ' + inst.instanceName}
                                        </MenuItem>
                                    ))
                                }
                            </Select>
                        </FormControl>
                        <FormControlLabel sx={{ m: 0 }} control={<Checkbox size="small" />} checked={externalEvent} onChange={e => setExternalEvent(e.target.checked)} label={<Typography variant="body2">OR/BTH</Typography>} />
                    </FormGroup>
                    
                    {pluginTable}
                </Box>
                
                <Box sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', bgcolor: 'background.paper' }}>
                    <Button variant="contained" color="primary"
                        sx={{ minWidth: '100px' }}
                        onClick={async () => {
                            let obj = {
                                name: name,
                                pass: pass,
                                server: server,
                                plugins: plugins,
                                externalEvent: externalEvent
                            }
                            if (!isNewUser) {
                                obj.id = props.selectedUser.id
                                if (pass === "") obj.pass = props.selectedUser.pass
                            }

                            props.ws.send(JSON.stringify([
                                ErrorType.Success,
                                isNewUser ? ActionType.AddUser : ActionType.SetUser,
                                obj
                            ]))

                            props.closeBackdrop()
                        }}
                    >
                        {t("Save")}
                    </Button>
                </Box>
            </Paper>
        </div>
    )
}