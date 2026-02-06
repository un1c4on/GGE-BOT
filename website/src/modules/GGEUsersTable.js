import * as React from 'react'
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Button, Backdrop, Box, Typography, Chip
} from '@mui/material'

import { ErrorType, ActionType, LogLevel } from "../types.js"
import { getTranslation } from '../translations.js'

function Log(props) {
    const [currentLogs, setCurrentLogs] = React.useState([])
    const { t, isOpen } = props;

    React.useEffect(() => {
        const logGrabber = msg => {
            let [err, action, obj] = JSON.parse(msg.data.toString())
            if (Number(action) !== ActionType.GetLogs || Number(err) !== ErrorType.Success) return

            setCurrentLogs(obj[0].splice(obj[1], obj[0].length - 1).concat(obj[0]).map((obj, index) =>
                <div key={`${Date.now()}-${index}`} style={{
                    color: obj[0] === LogLevel.Error ? "#ff5555" : obj[0] === LogLevel.Warn ? "#ffb86c" : "#8be9fd",
                    fontFamily: 'monospace', borderBottom: '1px solid #333', padding: '2px 0'
                }}>
                    <span style={{ color: '#6272a4', marginRight: '10px' }}>[{new Date().toLocaleTimeString()}]</span>
                    {obj[1]}
                </div>
            ).reverse())
        }
        props.ws.addEventListener("message", logGrabber)

        // Log penceresi AÇIKSA ve kullanıcı belliyse iste
        if (props.user && isOpen) {
            props.ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs, props.user]));
        }

        return () => props.ws.removeEventListener("message", logGrabber)
    }, [props.ws, props.user, isOpen]) // isOpen bağımlılığı eklendi

    return (
        <Paper sx={{ maxHeight: '90%', overflow: 'hidden', height: '80%', width: '60%', bgcolor: '#000', color: '#f8f8f2', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ p: 1, borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#1e1e1e' }}>
                <Typography variant="h6" sx={{ color: '#fff', fontFamily: 'monospace' }}>
                    {props.user ? `${props.user.name} Logs` : "System Logs"}
                </Typography>
                <Button variant="outlined" color="error" size="small" onClick={() => setCurrentLogs([])}>
                    {t("Clear Logs")}
                </Button>
            </Box>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", height: "100%", overflowY: 'auto', padding: '10px', backgroundColor: '#000' }}>
                <Typography variant="body2" component="div" align='left' sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {currentLogs}
                </Typography>
            </div>
        </Paper>)
}

export default function GGEUserTable(props) {
    const { language } = props;
    const t = (key) => getTranslation(language, key);

    const [openLogs, setOpenLogs] = React.useState(false)
    const [logUser, setLogUser] = React.useState(null)

    const handleLogClose = () => { setOpenLogs(false); setLogUser(null); }
    const handleLogOpen = () => setOpenLogs(true)

    const PlayerTable = () => {
        return (
            <TableContainer component={Paper} sx={{ bgcolor: 'rgba(10, 25, 41, 0.5)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>{t("Name")}</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>{t("Plugins")}</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>{t("Status")}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold' }}>{t("Actions")}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {props.rows.map((row, index) => {
                            const PlayerRow = () => {
                                const getEnabledPlugins = () => {
                                    let enabledPlugins = []
                                    Object.entries(row.plugins).forEach(([key, value]) => {
                                        if (value.state === true && key !== 'presets') {
                                            // Find plugin info from props.plugins to get the proper name
                                            const plugin = props.plugins.find(p => p.key === key);
                                            const displayName = plugin ? t(plugin.name) : t(key);
                                            enabledPlugins.push(displayName);
                                        }
                                    })
                                    return enabledPlugins
                                }
                                const [state, setState] = React.useState(row.state)
                                row.state = state
                                let status = props.usersStatus[row.id] ?? {}

                                return (
                                    <TableRow sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                        <TableCell component="th" scope="row">{row.name} <Typography variant="caption" color="gray">({row.server})</Typography></TableCell>
                                        <TableCell align="left">{getEnabledPlugins().join(", ")}</TableCell>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', gap: 1 }}>
                                                {status.level && <Chip label={`${t("Level")} ${status.level}`} size="small" variant="outlined" />}
                                                {status.coin && <Chip label={`${status.coin} ${t("Coin")}`} size="small" color="warning" />}
                                                {status.rubies && <Chip label={`${status.rubies} ${t("Rubies")}`} size="small" color="error" />}
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Button size="small" onClick={() => { setLogUser(row); handleLogOpen() }}>{t("Logs")}</Button>
                                            <Button size="small" onClick={() => props.onSelectUser(row)}>{t("Settings")}</Button>
                                            <Button size="small" variant="contained" color={state ? "error" : "success"} onClick={() => {
                                                row.state = !state; props.ws.send(JSON.stringify([ErrorType.Success, ActionType.SetUser, row])); setState(!state)
                                            }} sx={{ ml: 1 }}>{state ? t("Stop") : t("Start")}</Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            }
                            return <PlayerRow key={row.id} />
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        )
    }

    return (
        <>
            <Backdrop sx={theme => ({ color: '#fff', zIndex: theme.zIndex.drawer + 1 })} open={openLogs} onClick={() => { props.ws.send(JSON.stringify([ErrorType.Success, ActionType.GetLogs, undefined])); handleLogClose() }}>
                <Log ws={props.ws} t={t} user={logUser} isOpen={openLogs} />
            </Backdrop>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h5" fontWeight="bold" color="primary">{t("Bot Durumu")}</Typography>
            </Box>

            <PlayerTable />
        </>
    )
}