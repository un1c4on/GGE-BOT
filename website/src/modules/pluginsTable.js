import * as React from 'react'
import { 
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
    Paper, Checkbox, Select, Box, MenuItem, 
    FormControl, InputLabel, TextField, FormControlLabel, Slider, Typography, Grid 
} from '@mui/material'
import { getTranslation } from '../translations.js'

export default function PluginsTable(props) {
    const { language, singlePlugin } = props;
    const t = (key) => getTranslation(language, key);

    const userPlugins = props.userPlugins ?? {}
    const array_chunks = (array, chunk_size) => Array(Math.ceil(array.length / chunk_size)).fill().map((_, index) => index * chunk_size).map(begin => array.slice(begin, begin + chunk_size))
    
    const PluginOption = ({ pluginData, parentKey }) => {
        userPlugins[parentKey] ??= {}
        userPlugins[parentKey][pluginData.key] ??= pluginData.default
        const [value, setValue] = React.useState(userPlugins[parentKey][pluginData.key])

        const onChange = (newValue) => {
            userPlugins[parentKey][pluginData.key] = newValue
            setValue(newValue)
            props.onChange({ ...userPlugins })
        }

        switch (pluginData.type) {
            case "Label":
                return <Typography variant="subtitle2" sx={{ width: '100%', borderBottom: '1px solid #333', pb: 0.5, mb: 1, color: '#90caf9', mt: 2, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.75rem' }}>{t(pluginData.label)}</Typography>
            case "Text":
                return <TextField fullWidth label={t(pluginData.label)} variant="outlined" size="small" value={value} onChange={(e) => onChange(e.target.value)} sx={{ my: 1 }} />
            case "Checkbox":
                return <FormControlLabel control={<Checkbox size="small" checked={!!value} onChange={(_, nv) => onChange(nv)} />} label={<Typography variant="body2">{t(pluginData.label)}</Typography>} sx={{ my: 0.5 }} />
            case "Select":
                return <FormControl fullWidth size="small" sx={{ my: 1 }}>
                    <InputLabel>{t(pluginData.label)}</InputLabel>
                    <Select value={value} label={pluginData.label} onChange={(e) => onChange(e.target.value)}>
                        {pluginData.selection.map((e, i) => <MenuItem value={i} key={i}>{e}</MenuItem>)}
                    </Select>
                </FormControl>
            case "Slider":
                return <Box sx={{ px: 2, my: 2 }}>
                    <Typography variant="caption" color="gray">{t(pluginData.label)} ({value}%)</Typography>
                    <Slider size="small" value={value} onChange={(_, nv) => onChange(nv)} />
                </Box>
            case "Table":
                return <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'rgba(0,0,0,0.2)', my: 1 }}>
                    <Table size="small">
                        <TableHead><TableRow>
                            {pluginData.row.map(c => <TableCell key={c} sx={{ fontSize: '0.7rem', fontWeight: 'bold' }}>{t(c)}</TableCell>)}
                        </TableRow></TableHead>
                        <TableBody>
                            {array_chunks(pluginData.data, pluginData.row.length).map((chunk, idx) => (
                                <TableRow key={idx}>
                                    {chunk.map(item => (
                                        <TableCell key={item.key} sx={{ p: 0.5 }}>
                                            <PluginOption pluginData={item} parentKey={parentKey} />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            default: return null
        }
    }

    // Single plugin view (Sidebar'dan seçilen)
    if (singlePlugin) {
        return (
            <Box>
                <Grid container spacing={2}>
                    {singlePlugin.pluginOptions?.map((opt) => (
                        <Grid item xs={opt.type === 'Table' || opt.type === 'Label' ? 12 : 6} key={opt.key}>
                            <PluginOption pluginData={opt} parentKey={singlePlugin.key} />
                        </Grid>
                    ))}
                </Grid>
            </Box>
        )
    }

    // Default view (Fallback - List view)
    return (
        <TableContainer component={Paper} sx={{ bgcolor: '#1a1a1a' }}>
            <Table size="small">
                <TableHead><TableRow>
                    <TableCell sx={{ color: '#90caf9' }}>Name</TableCell>
                    <TableCell sx={{ color: '#90caf9' }}>Description</TableCell>
                </TableRow></TableHead>
                <TableBody>
                    {props.plugins.map(p => (
                        <TableRow key={p.key}>
                            <TableCell sx={{ fontWeight: 'bold' }}>{p.name}</TableCell>
                            <TableCell sx={{ fontSize: '0.8rem' }}>{p.description}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    )
}
