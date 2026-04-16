import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from './src/screens/LoginScreen';
import CaptureScreen from './src/screens/CaptureScreen';
import RecentScreen from './src/screens/RecentScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer
      theme={{
        dark: true,
        colors: {
          background: '#0a1628', card: '#0f2044', text: '#e8eef6',
          primary: '#c9a84c', border: '#162d5a', notification: '#e05c5c',
        },
      }}
    >
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerStyle: { backgroundColor: '#0f2044' },
          headerTintColor: '#e8c96b',
          headerTitleStyle: { fontWeight: '700' },
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'NBE DMS' }} />
        <Stack.Screen name="Capture" component={CaptureScreen} options={{ title: 'Capture Document' }} />
        <Stack.Screen name="Recent" component={RecentScreen} options={{ title: 'Recent Uploads' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
