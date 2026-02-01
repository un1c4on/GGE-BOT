import * as React from 'react'
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Checkbox, Select, Box, MenuItem,
    FormControl, InputLabel, TextField, FormControlLabel, Slider, Typography, Grid
} from '@mui/material'
import { getTranslation } from '../translations.js'

// Helper function
const array_chunks = (array, chunk_size) => Array(Math.ceil(array.length / chunk_size)).fill().map((_, index) => index * chunk_size).map(begin => array.slice(begin, begin + chunk_size))

// Component moved OUTSIDE to prevent remounting issues
const PluginOption = ({ pluginData, parentKey, userPlugins, onChange, t }) => {
    // Ensure nested object exists
    if (!userPlugins[parentKey]) userPlugins[parentKey] = {};
    if (userPlugins[parentKey][pluginData.key] === undefined) userPlugins[parentKey][pluginData.key] = pluginData.default;

    // Use local state for inputs to allow typing without immediate re-render lag
    // However, since we fixed the component definition, standard controlled input should work fine.
    // If props update from parent, we want to reflect that.
    const currentValue = userPlugins[parentKey][pluginData.key];

    const handleChange = (newValue) => {
        // Mutate the object directly (as per original logic logic was weird but we keep the structure)
        // Ideally we should copy, but the parent 'onChange' expects the whole object
        userPlugins[parentKey][pluginData.key] = newValue;
        onChange({ ...userPlugins }); // Trigger parent update
    }

    switch (pluginData.type) {
        case "Label":
            return <Typography variant="subtitle2" sx={{ width: '100%', borderBottom: '1px solid #333', pb: 0.5, mb: 1, color: '#90caf9', mt: 2, fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.75rem' }}>{t(pluginData.label)}</Typography>
        case "Text":
            return <TextField fullWidth label={t(pluginData.label)} variant="outlined" size="small" value={currentValue || ""} onChange={(e) => handleChange(e.target.value)} sx={{ my: 1 }} />
        case "TextArea": // Added support for TextArea
            return <TextField fullWidth multiline rows={4} label={t(pluginData.label)} variant="outlined" size="small" value={currentValue || ""} onChange={(e) => handleChange(e.target.value)} sx={{ my: 1, '& .MuiInputBase-root': { fontSize: '0.8rem', fontFamily: 'monospace' } }} />
        case "Checkbox":
            return <FormControlLabel control={<Checkbox size="small" checked={!!currentValue} onChange={(_, nv) => handleChange(nv)} />} label={<Typography variant="body2">{t(pluginData.label)}</Typography>} sx={{ my: 0.5 }} />
        case "Select":
            return <FormControl fullWidth size="small" sx={{ my: 1 }}>
                <InputLabel>{t(pluginData.label)}</InputLabel>
                <Select value={currentValue} label={pluginData.label} onChange={(e) => handleChange(e.target.value)}>
                    {pluginData.selection.map((e, i) => <MenuItem value={i} key={i}>{t(e)}</MenuItem>)}
                </Select>
            </FormControl>
        case "Slider":
            return <Box sx={{ px: 2, my: 2 }}>
                <Typography variant="caption" color="gray">{t(pluginData.label)} ({currentValue}%)</Typography>
                <Slider size="small" value={currentValue} onChange={(_, nv) => handleChange(nv)} />
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
                                        <PluginOption pluginData={item} parentKey={parentKey} userPlugins={userPlugins} onChange={onChange} t={t} />
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

export default function PluginsTable(props) {
    const { language, singlePlugin } = props;
    const t = (key) => getTranslation(language, key);

    const userPlugins = props.userPlugins ?? {}

    // Single plugin view (Sidebar'dan seçilen)
    if (singlePlugin) {
        return (
            <Box>
                <Grid container spacing={2}>
                    {singlePlugin.pluginOptions?.map((opt) => (
                        <Grid item xs={opt.type === 'Table' || opt.type === 'Label' || opt.type === 'TextArea' ? 12 : 6} key={opt.key}>
                            <PluginOption
                                pluginData={opt}
                                parentKey={singlePlugin.key}
                                userPlugins={userPlugins}
                                onChange={props.onChange}
                                t={t}
                            />
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
                    <TableCell sx={{ color: '#90caf9' }}>{t("Name")}</TableCell>
                    <TableCell sx={{ color: '#90caf9' }}>{t("Description")}</TableCell>
                </TableRow></TableHead>
                <TableBody>
                    {props.plugins.filter(p => p.key !== 'presets').map(p => (
                        <TableRow key={p.key}>
                            <TableCell sx={{ fontWeight: 'bold' }}>{t(p.name)}</TableCell>
                            <TableCell sx={{ fontSize: '0.8rem' }}>{t(p.description)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    )
}
